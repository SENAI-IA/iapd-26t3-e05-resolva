import { describe, expect, it } from "vitest";
import {
  ticketStatuses,
  type ImplementationEnvironment,
  type ImplementationTriage,
} from "./contracts.js";
import { transitionTicket } from "./ticket.js";

const id = "761c8145-ae36-410e-a010-7c294f621848";
const sourceHashes = { "docs/rules.md": "a".repeat(64) };
const evidence = {
  ruleStatus: "established" as const,
  behavior: "divergent" as const,
  verificationStatus: "succeeded" as const,
  evidenceSufficient: true,
  changeRequested: false,
  expectationMisunderstood: false,
  sources: [{ path: "docs/rules.md", sha256: "a".repeat(64) }],
  questions: [],
  humanReviewRequired: false,
};
const ticket = {
  id: 1,
  version: 2,
  status: "aguardando_implementacao" as const,
  currentTriageId: id,
  classification: "bug" as const,
};
const triage: ImplementationTriage = {
  id,
  ticketId: 1,
  ticketVersion: 2,
  classification: "bug",
  status: "valid",
  sourceHashes,
  changeScope: null,
  acceptanceCriteria: [],
  regressionTestPlan: "Cobrir duas unidades no cálculo do total.",
};
const environment: ImplementationEnvironment = {
  ready: true,
  activeExecutionId: null,
  sourceHashes,
};

describe("transições de triagem", () => {
  it.each(["aberto", "aguardando_informacoes", "aguardando_implementacao"] as const)(
    "permite análise explícita de %s sem iniciar implementação",
    (status) => {
      expect(transitionTicket(status, { type: "analyze" })).toBe("em_triagem");
    },
  );

  it.each(["em_triagem", "recusado", "em_andamento", "aguardando_revisao", "resolvido"] as const)(
    "bloqueia nova análise em %s; recusa exige contestação e resolvido exige reabertura",
    (status) => {
      expect(() => transitionTicket(status, { type: "analyze" })).toThrow(
        expect.objectContaining({ code: "CONFLICT" }),
      );
    },
  );

  it.each([
    [{}, "aguardando_implementacao"],
    [{ behavior: "conforming", changeRequested: true }, "aguardando_implementacao"],
    [{ behavior: "disproved" }, "recusado"],
    [{ behavior: "conforming", expectationMisunderstood: true }, "recusado"],
    [{ ruleStatus: "conflicting", questions: ["Qual regra usar?"] }, "aguardando_informacoes"],
    [{ behavior: "unverified" }, "aberto"],
  ] as const)("conclui triagem segundo as evidências %j", (input, expected) => {
    expect(
      transitionTicket("em_triagem", {
        type: "complete_triage",
        evidence: { ...evidence, ...input },
      }),
    ).toBe(expected);
  });

  it.each(ticketStatuses.filter((status) => status !== "em_triagem"))(
    "impede aplicar uma conclusão de triagem em %s",
    (status) => {
      expect(() => transitionTicket(status, { type: "complete_triage", evidence })).toThrow(
        expect.objectContaining({ code: "CONFLICT" }),
      );
    },
  );
});

describe("transição de início manual", () => {
  it("exige comando explícito e elegibilidade para sair da fila", () => {
    expect(
      transitionTicket("aguardando_implementacao", {
        type: "start_implementation",
        ticket,
        triage,
        environment,
      }),
    ).toBe("em_andamento");
  });

  it.each([
    { triage: null },
    { triage: { ...triage, status: "invalidated" as const } },
    { triage: { ...triage, regressionTestPlan: null } },
    { ticket: { ...ticket, version: 3 } },
    { environment: { ...environment, ready: false } },
    { environment: { ...environment, activeExecutionId: id } },
    { environment: { ...environment, sourceHashes: {} } },
    {
      ticket: { ...ticket, classification: "inconclusivo" as const },
      triage: { ...triage, classification: "inconclusivo" as const },
    },
  ])("recalcula os bloqueios e impede início com %j", (input) => {
    expect(() =>
      transitionTicket("aguardando_implementacao", {
        type: "start_implementation",
        ticket,
        triage,
        environment,
        ...input,
      }),
    ).toThrow(expect.objectContaining({ name: "DomainError" }));
  });

  it("não aceita estado informado divergente do ticket real", () => {
    expect(() =>
      transitionTicket("aguardando_implementacao", {
        type: "start_implementation",
        ticket: { ...ticket, status: "recusado" },
        triage,
        environment,
      }),
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(() =>
      transitionTicket("recusado", { type: "start_implementation", ticket, triage, environment }),
    ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });
});
