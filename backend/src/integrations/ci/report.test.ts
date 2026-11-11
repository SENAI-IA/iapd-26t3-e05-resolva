import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  pipelineReport,
  pipelineReportContext,
  vitestFile,
  vitestReport,
} from "../../test/pipelineReport.js";
import { parsePipelineReport } from "./report.js";

function parse(value: unknown, secrets: readonly string[] = []) {
  return parsePipelineReport(Buffer.from(JSON.stringify(value)), pipelineReportContext, secrets);
}

describe("relatório coletado da pipeline", () => {
  it("aceita fixtures produzidas pelo Vitest instalado com baseline, asserção vermelha e correção", () => {
    const value = pipelineReport();
    for (const phase of ["baseline", "regression", "final"] as const)
      value.validation[phase].report = JSON.parse(
        readFileSync(
          new URL(`../../test/fixtures/vitest-json/${phase}.json`, import.meta.url),
          "utf8",
        ),
      );
    value.files = {
      "src/orders/total.ts": 1,
      "tests/existing.test.ts": 4,
      "tests/quantity.test.ts": 3,
    };
    value.runReport.references = [{ path: "src/orders/total.ts", startLine: 1, endLine: 1 }];
    expect(parse(value).evidence).toMatchObject({
      baseline: { total: 2, passed: 2 },
      regression: { total: 3, failed: 1 },
      final: { total: 3, passed: 3 },
    });
  });
  it("deriva evidência e callback dos relatórios conferidos, sem aceitar resumo autoaprovado", () => {
    const result = parse(pipelineReport());
    expect(result.evidence).toMatchObject({
      executionId: pipelineReportContext.executionId,
      commitSha: "a".repeat(40),
      baseline: { total: 2, passed: 2 },
      regression: { status: "assertion_failed", failed: 1 },
      final: { total: 3, passed: 3 },
    });
    expect(result.callback).toMatchObject({
      status: "success",
      branch: pipelineReportContext.branchName,
      pullRequest: { number: 12 },
    });
  });

  it("normaliza caminhos absolutos do runner e remove campos livres do Vitest", () => {
    const value = pipelineReport();
    for (const process of Object.values(value.validation)) {
      for (const file of process.report.testResults) file.name = `/runner/project/${file.name}`;
    }
    Object.assign(value.validation.final.report, { pensamento_interno: "nao-persistir" });
    const result = parse(value);
    expect(result.content.toString()).not.toContain("nao-persistir");
    expect(result.content.toString()).not.toContain("/runner/project");
  });

  it("sanitiza mensagens e relatório Kiro antes de produzir o arquivo persistível", () => {
    const value = pipelineReport();
    value.runReport.diagnosis = "Diagnóstico com token-ficticio e texto.";
    value.validation.regression.report.testResults[0]!.assertionResults[0]!.failureMessages = [
      "Falha token-ficticio",
    ];
    const result = parse(value, ["token-ficticio"]);
    expect(result.content.toString()).not.toContain("token-ficticio");
    expect(result.content.toString()).toContain("[REDACTED]");
    expect(
      parsePipelineReport(result.content, pipelineReportContext, ["token-ficticio"]).content,
    ).toEqual(result.content);
  });

  it.each([
    { executionId: "44444444-4444-4444-8444-444444444444" },
    { workflowAttempt: 2 },
    { workflowDefinitionId: "457" },
    { ticketVersion: 2 },
    { configHash: "d".repeat(64) },
    { branchName: "resolva/outro" },
    { classification: "melhoria" },
    { acceptanceCriteria: ["Outro comportamento"] },
    { round: 4 },
    { files: { "../secret": 1, "tests/quantity.test.ts": 20 } },
    {
      test: {
        path: "src/orders/total.ts",
        frozenSha256: "c".repeat(64),
        finalSha256: "c".repeat(64),
      },
    },
    {
      test: {
        path: "tests/quantity.test.ts",
        frozenSha256: "c".repeat(64),
        finalSha256: "d".repeat(64),
      },
    },
    {
      pullRequest: {
        number: 12,
        url: "https://token@github.com/equipe/alvo/pull/12",
        state: "OPEN",
      },
    },
  ])("recusa identidade, manifesto ou hash divergente: %j", (overrides) => {
    expect(() => parse({ ...pipelineReport(), ...overrides })).toThrow(
      "Relatório da pipeline inválido.",
    );
  });

  it.each(["baseline", "regression", "final"] as const)(
    "recusa %s sem asserções reais mesmo com contador verde",
    (phase) => {
      const value = pipelineReport();
      value.validation[phase].report.testResults = [];
      expect(() => parse(value)).toThrow("Relatório da pipeline inválido.");
    },
  );

  it.each(["timeout", "runner", "zero", "skip"])("recusa reprodução por %s", (reason) => {
    const value = pipelineReport();
    if (reason === "timeout") value.validation.regression.timedOut = true;
    if (reason === "runner") value.validation.regression.exitCode = 2;
    if (reason === "zero") value.validation.regression.report = vitestReport([]);
    if (reason === "skip")
      Object.assign(value.validation.regression.report, { numPendingTests: 1 });
    expect(() => parse(value)).toThrow("Relatório da pipeline inválido.");
  });

  it("recusa falha em outro teste e desaparecimento de testes existentes", () => {
    const first = pipelineReport();
    first.validation.regression.report = vitestReport([
      vitestFile("tests/existing.test.ts", [{ name: "mantém centavos", failed: true }]),
    ]);
    expect(() => parse(first)).toThrow("Relatório da pipeline inválido.");
    const second = pipelineReport();
    second.validation.final.report = vitestReport([
      vitestFile("tests/quantity.test.ts", [
        { name: "outro teste" },
        { name: "mais um" },
        { name: "mais outro" },
      ]),
    ]);
    expect(() => parse(second)).toThrow("Relatório da pipeline inválido.");
  });

  it("aceita melhoria com teste novo aprovado e sem simular asserção vermelha", () => {
    const value = pipelineReport();
    Object.assign(value, { classification: "melhoria" });
    Object.assign(value.runReport, { expectedFailure: null });
    value.validation.regression = {
      exitCode: 0,
      timedOut: false,
      report: vitestReport([
        vitestFile("tests/quantity.test.ts", [{ name: "multiplica quantidade" }]),
      ]),
    };
    const result = parsePipelineReport(
      Buffer.from(JSON.stringify(value)),
      { ...pipelineReportContext, classification: "melhoria" },
      [],
    );
    expect(result.evidence.regression.status).toBe("passed");
  });

  it("recusa segredo em campos de identidade em vez de alterar sua semântica", () => {
    expect(() => parse(pipelineReport(), ["tests/quantity.test.ts"])).toThrow(
      "Relatório da pipeline inválido.",
    );
  });

  it("limita JSON, UTF-8 e tamanho antes de interpretar o relatório", () => {
    expect(() => parsePipelineReport(Buffer.from([0xff]), pipelineReportContext, [])).toThrow();
    expect(() =>
      parsePipelineReport(Buffer.alloc(64 * 1024 + 1, 32), pipelineReportContext, []),
    ).toThrow();
    expect(() => parsePipelineReport(Buffer.from("{"), pipelineReportContext, [])).toThrow();
  });
});
