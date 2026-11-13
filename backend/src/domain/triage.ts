import {
  sourceHashesSchema,
  triageEvidenceSchema,
  type EligibilityResult,
  type ImplementationEnvironment,
  type ImplementationTicket,
  type ImplementationTriage,
  type TriageDecision,
} from "./contracts.js";
import { DomainError } from "./error.js";

export function classifyTriage(input: unknown): TriageDecision {
  const parsed = triageEvidenceSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("BAD_REQUEST", "Evidências de triagem inválidas.");
  const evidence = parsed.data;
  const inconclusive: TriageDecision = {
    classification: "inconclusivo",
    status: evidence.questions.length > 0 ? "aguardando_informacoes" : "aberto",
    questions: evidence.questions,
    humanReviewRequired: evidence.humanReviewRequired || evidence.questions.length === 0,
  };
  if (
    evidence.ruleStatus !== "established" ||
    evidence.verificationStatus === "failed" ||
    evidence.verificationStatus === "unavailable" ||
    !evidence.evidenceSufficient ||
    evidence.sources.length === 0 ||
    evidence.questions.length > 0 ||
    evidence.humanReviewRequired
  ) {
    return inconclusive;
  }

  let classification: TriageDecision["classification"];
  switch (evidence.behavior) {
    case "divergent":
      classification = "bug";
      break;
    case "disproved":
      classification = "falso_positivo";
      break;
    case "conforming":
      if (evidence.changeRequested) classification = "melhoria";
      else if (evidence.expectationMisunderstood) classification = "entendimento_incorreto";
      else return inconclusive;
      break;
    case "unverified":
      return inconclusive;
  }
  return {
    classification,
    status:
      classification === "bug" || classification === "melhoria"
        ? "aguardando_implementacao"
        : "recusado",
    questions: [],
    humanReviewRequired: false,
  };
}

export function isTriageValid(
  triage: ImplementationTriage | null,
  ticket: ImplementationTicket,
  currentSourceHashes: Readonly<Record<string, string>>,
): boolean {
  if (
    !triage ||
    triage.status !== "valid" ||
    triage.id !== ticket.currentTriageId ||
    triage.ticketId !== ticket.id ||
    triage.ticketVersion !== ticket.version ||
    triage.classification !== ticket.classification ||
    !sourceHashesSchema.safeParse(triage.sourceHashes).success
  ) {
    return false;
  }
  const sources = Object.entries(triage.sourceHashes);
  return (
    sources.length > 0 &&
    sources.every(
      ([path, hash]) =>
        Object.hasOwn(currentSourceHashes, path) && currentSourceHashes[path] === hash,
    )
  );
}

export function canStartImplementation(
  ticket: ImplementationTicket,
  triage: ImplementationTriage | null,
  environment: ImplementationEnvironment,
): EligibilityResult {
  if (ticket.status !== "aguardando_implementacao") {
    return {
      eligible: false,
      code: "IMPLEMENTATION_NOT_ELIGIBLE",
      message: "O ticket deve aguardar implementação. Analise o ticket antes de iniciar.",
    };
  }
  if (
    environment.targetSystemVersion !== undefined &&
    environment.targetSystemVersion !== null &&
    ticket.targetConfigVersion !== undefined &&
    ticket.targetConfigVersion !== environment.targetSystemVersion
  ) {
    return {
      eligible: false,
      code: "TRIAGE_OUTDATED",
      message: "A configuração do sistema-alvo mudou. Analise novamente o ticket antes de implementar.",
    };
  }
  if (!triage || !ticket.currentTriageId) {
    return {
      eligible: false,
      code: "TRIAGE_REQUIRED",
      message: "Analise o ticket antes de iniciar a implementação.",
    };
  }
  if (!environment.ready) {
    return {
      eligible: false,
      code: "PRECONDITION_FAILED",
      message: "Configure e valide o ambiente de implementação antes de iniciar.",
    };
  }
  if (!isTriageValid(triage, ticket, environment.sourceHashes)) {
    return {
      eligible: false,
      code: "TRIAGE_OUTDATED",
      message: `Analise novamente o ticket na versão ${ticket.version}; a triagem ou suas fontes estão desatualizadas.`,
    };
  }
  if (triage.classification !== "bug" && triage.classification !== "melhoria") {
    return {
      eligible: false,
      code: "IMPLEMENTATION_NOT_ELIGIBLE",
      message: "Somente bugs e melhorias com triagem válida podem ser implementados.",
    };
  }
  if (
    !triage.regressionTestPlan?.trim() ||
    (triage.classification === "melhoria" &&
      (!triage.changeScope?.trim() ||
        triage.acceptanceCriteria.length === 0 ||
        triage.acceptanceCriteria.some((criterion) => !criterion.trim())))
  ) {
    return {
      eligible: false,
      code: "CRITERIA_REQUIRED",
      message:
        "Complete o plano de testes e, para melhorias, o escopo e os critérios de aceite na triagem.",
    };
  }
  if (environment.activeExecutionId) {
    return {
      eligible: false,
      code: "ACTIVE_EXECUTION",
      message: "Aguarde o término da execução em andamento antes de iniciar outra.",
      activeExecutionId: environment.activeExecutionId,
    };
  }
  return { eligible: true };
}
