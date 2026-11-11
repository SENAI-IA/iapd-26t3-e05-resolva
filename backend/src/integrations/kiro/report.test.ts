import { describe, expect, it } from "vitest";
import { parseRunReport } from "./report.js";

const executionId = "11111111-1111-4111-8111-111111111111";
const context = {
  files: { "src/total.ts": 20, "tests/total.test.ts": 40 },
  testPaths: ["tests"],
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    executionId,
    phase: "regression",
    round: 0,
    outcome: "ready",
    summary: "Teste de regressão criado.",
    diagnosis: "O total ignorava a quantidade.",
    references: [{ path: "src/total.ts", startLine: 1, endLine: 3 }],
    questions: [],
    regressionTestPaths: ["tests/total.test.ts"],
    expectedFailure: { path: "tests/total.test.ts", summary: "Esperava 2500 e recebeu 1500." },
    ...overrides,
  };
}

describe("relatório de execução do Kiro", () => {
  it("valida identidade, referências e evidência de regressão", () => {
    expect(
      parseRunReport(base(), { executionId, phase: "regression", round: 0 }, context),
    ).toMatchObject({ outcome: "ready", regressionTestPaths: ["tests/total.test.ts"] });
  });

  it("aceita pedido de informação sem inventar teste ou falha", () => {
    expect(
      parseRunReport(
        base({
          phase: "analysis",
          outcome: "needs_information",
          references: [],
          questions: ["Qual regra deve prevalecer?"],
          regressionTestPaths: [],
          expectedFailure: null,
        }),
        { executionId, phase: "analysis", round: 0 },
        context,
      ),
    ).toMatchObject({ outcome: "needs_information", questions: ["Qual regra deve prevalecer?"] });
  });

  it.each([
    ["identidade incorreta", { executionId: "22222222-2222-4222-8222-222222222222" }],
    ["referência ausente", { references: [{ path: "docs/missing.md", startLine: 1, endLine: 1 }] }],
    ["teste fora do caminho permitido", { regressionTestPaths: ["src/total.ts"] }],
    ["regressão sem falha esperada", { expectedFailure: null }],
  ])("recusa %s", (_name, overrides) => {
    expect(() =>
      parseRunReport(base(overrides), { executionId, phase: "regression", round: 0 }, context),
    ).toThrow("Relatório de execução inválido.");
  });
});
