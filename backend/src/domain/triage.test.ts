import { describe, expect, it } from "vitest";
import { ticketStatuses } from "./contracts.js";
import { canStartImplementation, classifyTriage, isTriageValid } from "./triage.js";

const triageId = "761c8145-ae36-410e-a010-7c294f621848";
const sourceHashes = { "docs/rules.md": "a".repeat(64), "src/total.ts": "b".repeat(64) };
const evidence = {
  ruleStatus: "established" as const,
  behavior: "divergent" as const,
  verificationStatus: "succeeded" as const,
  evidenceSufficient: true,
  changeRequested: false,
  expectationMisunderstood: false,
  sources: [
    { path: "docs/rules.md", sha256: "a".repeat(64) },
    { path: "src/total.ts", sha256: "b".repeat(64) },
  ],
  questions: [] as string[],
  humanReviewRequired: false,
};
const ticket = {
  id: 1,
  version: 2,
  status: "aguardando_implementacao" as const,
  currentTriageId: triageId,
  classification: "bug" as const,
};
const triage = {
  id: triageId,
  ticketId: 1,
  ticketVersion: 2,
  classification: "bug" as const,
  status: "valid" as const,
  sourceHashes,
  changeScope: null,
  acceptanceCriteria: [] as string[],
  regressionTestPlan: "Validar duas unidades e o total esperado de 2500 centavos.",
};
const environment = { ready: true, activeExecutionId: null, sourceHashes };

describe("classificação baseada em evidências estruturadas", () => {
  it.each([
    [{ behavior: "disproved" }, "falso_positivo", "recusado"],
    [
      { behavior: "conforming", expectationMisunderstood: true },
      "entendimento_incorreto",
      "recusado",
    ],
    [{}, "bug", "aguardando_implementacao"],
    [{ behavior: "conforming", changeRequested: true }, "melhoria", "aguardando_implementacao"],
    [{ behavior: "unverified" }, "inconclusivo", "aberto"],
  ])("classifica %j como %s sem iniciar implementação", (input, classification, status) => {
    expect(classifyTriage({ ...evidence, ...input })).toMatchObject({ classification, status });
  });

  it.each([
    { ruleStatus: "missing" },
    { ruleStatus: "conflicting" },
    { verificationStatus: "failed" },
    { verificationStatus: "unavailable" },
    { evidenceSufficient: false },
    { sources: [] },
  ])("não recusa nem enfileira quando a conclusão é insuficiente: %j", (input) => {
    expect(classifyTriage({ ...evidence, behavior: "disproved", ...input })).toMatchObject({
      classification: "inconclusivo",
      status: "aberto",
      humanReviewRequired: true,
    });
  });

  it("não trata ausência de reprodução como prova de falso positivo", () => {
    expect(classifyTriage({ ...evidence, behavior: "unverified" }).classification).toBe(
      "inconclusivo",
    );
  });

  it("persiste no resultado perguntas de esclarecimento sem exigir testes", () => {
    expect(
      classifyTriage({
        ...evidence,
        ruleStatus: "conflicting",
        questions: ["  Qual regra de cálculo está vigente?  "],
      }),
    ).toEqual({
      classification: "inconclusivo",
      status: "aguardando_informacoes",
      questions: ["Qual regra de cálculo está vigente?"],
      humanReviewRequired: false,
    });
  });

  it("perguntas pendentes e revisão humana impedem conclusão de bug", () => {
    expect(classifyTriage({ ...evidence, questions: ["Qual quantidade?"] })).toMatchObject({
      classification: "inconclusivo",
      status: "aguardando_informacoes",
    });
    expect(classifyTriage({ ...evidence, humanReviewRequired: true })).toMatchObject({
      classification: "inconclusivo",
      status: "aberto",
      humanReviewRequired: true,
    });
  });

  it("não inventa uma recusa quando o comportamento conforme não explica o relato", () => {
    expect(classifyTriage({ ...evidence, behavior: "conforming" })).toMatchObject({
      classification: "inconclusivo",
      humanReviewRequired: true,
    });
  });

  it("divergência comprovada tem prioridade sobre pedido de melhoria", () => {
    expect(classifyTriage({ ...evidence, changeRequested: true }).classification).toBe("bug");
  });

  it("permite prova por leitura quando não há verificação executável prevista", () => {
    expect(classifyTriage({ ...evidence, verificationStatus: "not_run" })).toMatchObject({
      classification: "bug",
      status: "aguardando_implementacao",
    });
  });

  it.each([
    { behavior: "não reproduzido" },
    { evidenceSufficient: "true" },
    { questions: [" "] },
    { sources: [{ path: "../segredo", sha256: "a".repeat(64) }] },
    { sources: [{ path: "/etc/passwd", sha256: "a".repeat(64) }] },
    { sources: [{ path: "C:\\segredo", sha256: "a".repeat(64) }] },
    { sources: [{ path: "docs/rules.md", sha256: "hash-inválido" }] },
    { sources: [{ path: "docs/ru\nles.md", sha256: "a".repeat(64) }] },
    { sources: [{ path: "docs/ru\u007fles.md", sha256: "a".repeat(64) }] },
    { sources: [evidence.sources[0], evidence.sources[0]] },
    { classification: "bug" },
  ])("recusa evidência malformada sem aceitar classificação livre: %j", (input) => {
    expect(() => classifyTriage({ ...evidence, ...input })).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });
});

describe("validade da conclusão vigente", () => {
  it("exige a mesma identidade, versão e fontes analisadas", () => {
    expect(isTriageValid(triage, ticket, sourceHashes)).toBe(true);
  });

  it.each([
    { ticketId: 2 },
    { ticketVersion: 1 },
    { id: "73da3aa9-f9a7-45eb-bad7-b480368db14b" },
    { status: "invalidated" as const },
    { status: "superseded" as const },
    { classification: "melhoria" as const },
    { sourceHashes: {} },
  ])("rejeita conclusão com vínculo ou validade divergente: %j", (input) => {
    expect(isTriageValid({ ...triage, ...input }, ticket, sourceHashes)).toBe(false);
  });

  it("rejeita ticket sem referência vigente ou com outra versão", () => {
    expect(isTriageValid(triage, { ...ticket, currentTriageId: null }, sourceHashes)).toBe(false);
    expect(isTriageValid(triage, { ...ticket, version: 3 }, sourceHashes)).toBe(false);
    expect(isTriageValid(null, ticket, sourceHashes)).toBe(false);
  });

  it("invalida regra alterada, código removido e hashes inválidos", () => {
    expect(
      isTriageValid(triage, ticket, { ...sourceHashes, "docs/rules.md": "c".repeat(64) }),
    ).toBe(false);
    expect(isTriageValid(triage, ticket, { "docs/rules.md": "a".repeat(64) })).toBe(false);
    expect(
      isTriageValid({ ...triage, sourceHashes: { "docs/rules.md": "" } }, ticket, {
        "docs/rules.md": "",
      }),
    ).toBe(false);
  });

  it("não invalida por fonte adicional que não participou da análise", () => {
    expect(
      isTriageValid(triage, ticket, { ...sourceHashes, "docs/other.md": "c".repeat(64) }),
    ).toBe(true);
  });
});

describe("elegibilidade para início manual", () => {
  it("autoriza bug com plano de regressão sem fabricar teste vermelho na triagem", () => {
    expect(canStartImplementation(ticket, triage, environment)).toEqual({ eligible: true });
  });

  it("autoriza melhoria com escopo, critérios e plano de testes do novo comportamento", () => {
    expect(
      canStartImplementation(
        { ...ticket, classification: "melhoria" },
        {
          ...triage,
          classification: "melhoria",
          changeScope: "Adicionar desconto em pedidos.",
          acceptanceCriteria: ["Desconto de 10% quando houver duas unidades."],
          regressionTestPlan: "Cobrir pedidos com e sem desconto.",
        },
        environment,
      ),
    ).toEqual({ eligible: true });
  });

  it.each(ticketStatuses.filter((status) => status !== "aguardando_implementacao"))(
    "bloqueia o estado %s",
    (status) => {
      expect(canStartImplementation({ ...ticket, status }, triage, environment)).toMatchObject({
        eligible: false,
        code: "IMPLEMENTATION_NOT_ELIGIBLE",
      });
    },
  );

  it.each(["falso_positivo", "entendimento_incorreto", "inconclusivo"] as const)(
    "bloqueia classificação %s mesmo em ticket artificialmente enfileirado",
    (classification) => {
      expect(
        canStartImplementation(
          { ...ticket, classification },
          { ...triage, classification },
          environment,
        ),
      ).toMatchObject({ eligible: false, code: "IMPLEMENTATION_NOT_ELIGIBLE" });
    },
  );

  it("explica ausência de triagem e versão desatualizada", () => {
    expect(canStartImplementation(ticket, null, environment)).toMatchObject({
      eligible: false,
      code: "TRIAGE_REQUIRED",
    });
    const result = canStartImplementation({ ...ticket, version: 3 }, triage, environment);
    expect(result).toMatchObject({ eligible: false, code: "TRIAGE_OUTDATED" });
    if (!result.eligible) expect(result.message).toContain("3");
  });

  it("bloqueia antes da implementação quando as fontes atuais mudam", () => {
    expect(
      canStartImplementation(ticket, triage, {
        ...environment,
        sourceHashes: { ...sourceHashes, "src/total.ts": "c".repeat(64) },
      }),
    ).toMatchObject({ eligible: false, code: "TRIAGE_OUTDATED" });
  });

  it.each([null, "", "   "])("exige plano de regressão do bug: %j", (regressionTestPlan) => {
    expect(
      canStartImplementation(ticket, { ...triage, regressionTestPlan }, environment),
    ).toMatchObject({ eligible: false, code: "CRITERIA_REQUIRED" });
  });

  it.each([
    { changeScope: null, acceptanceCriteria: ["Critério"] },
    { changeScope: "   ", acceptanceCriteria: ["Critério"] },
    { changeScope: "Novo desconto", acceptanceCriteria: [] },
    { changeScope: "Novo desconto", acceptanceCriteria: [" "] },
    { changeScope: "Novo desconto", acceptanceCriteria: ["Critério"], regressionTestPlan: null },
  ])("exige todos os critérios específicos de melhoria: %j", (criteria) => {
    expect(
      canStartImplementation(
        { ...ticket, classification: "melhoria" },
        { ...triage, classification: "melhoria", ...criteria },
        environment,
      ),
    ).toMatchObject({ eligible: false, code: "CRITERIA_REQUIRED" });
  });

  it("informa pré-condição de ambiente sem bloquear cadastro", () => {
    expect(canStartImplementation(ticket, triage, { ...environment, ready: false })).toMatchObject({
      eligible: false,
      code: "PRECONDITION_FAILED",
    });
  });

  it("informa pré-condição de ambiente antes de verificar fontes quando o ambiente não está pronto", () => {
    expect(
      canStartImplementation(ticket, triage, {
        ready: false,
        activeExecutionId: null,
        sourceHashes: {},
      }),
    ).toMatchObject({ eligible: false, code: "PRECONDITION_FAILED" });
  });

  it("informa a execução ativa global, inclusive quando ela é uma triagem", () => {
    expect(
      canStartImplementation(ticket, triage, { ...environment, activeExecutionId: triageId }),
    ).toMatchObject({ eligible: false, code: "ACTIVE_EXECUTION", activeExecutionId: triageId });
  });

  it("mantém os dados de entrada intactos ao calcular decisões", () => {
    const before = structuredClone({ ticket, triage, environment, evidence });
    classifyTriage(evidence);
    canStartImplementation(ticket, triage, environment);
    expect({ ticket, triage, environment, evidence }).toEqual(before);
  });
});
