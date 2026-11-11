import { testTargetSnapshot } from "./projectConfig.js";
import type { PipelineReportContext } from "../integrations/ci/report.js";

export const pipelineReportContext = {
  executionId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  ticketId: 1,
  ticketVersion: 1,
  triageId: "33333333-3333-4333-8333-333333333333",
  configHash: testTargetSnapshot.snapshotHash,
  repository: "equipe/alvo",
  branchName: "resolva/res-1-11111111",
  workflowId: "987654",
  workflowDefinitionId: "456",
  workflowAttempt: 1,
  classification: "bug" as const,
  acceptanceCriteria: ["Quantidade correta"],
  testPaths: ["tests"],
  allowedPaths: ["src", "tests"],
  documentationPaths: ["docs"],
  maxRounds: 3,
};

export function vitestFile(path: string, assertions: Array<{ name: string; failed?: boolean }>) {
  return {
    name: path,
    status: assertions.some((test) => test.failed) ? "failed" : "passed",
    message: "",
    assertionResults: assertions.map((test) => ({
      status: test.failed ? "failed" : "passed",
      title: test.name,
      fullName: test.name,
      ancestorTitles: [],
      failureMessages: test.failed ? ["Esperado 2500, recebido 1500."] : [],
    })),
  };
}
export function vitestReport(files: ReturnType<typeof vitestFile>[]) {
  const assertions = files.flatMap((file) => file.assertionResults);
  const failed = assertions.filter((test) => test.status === "failed").length;
  return {
    numTotalTests: assertions.length,
    numPassedTests: assertions.length - failed,
    numFailedTests: failed,
    numPendingTests: 0,
    numTodoTests: 0,
    success: failed === 0,
    testResults: structuredClone(files),
  };
}
export function pipelineReport(context: PipelineReportContext = pipelineReportContext) {
  const baseline = vitestFile("tests/existing.test.ts", [
    { name: "mantém centavos" },
    { name: "quantidade um" },
  ]);
  const regression = vitestFile("tests/quantity.test.ts", [
    { name: "multiplica quantidade", failed: true },
  ]);
  const fixed = vitestFile("tests/quantity.test.ts", [{ name: "multiplica quantidade" }]);
  return {
    schemaVersion: 1,
    executionId: context.executionId,
    deliveryId: context.deliveryId,
    ticketId: context.ticketId,
    ticketVersion: context.ticketVersion,
    triageId: context.triageId,
    configHash: context.configHash,
    repository: context.repository,
    branchName: context.branchName,
    workflowId: context.workflowId,
    workflowDefinitionId: context.workflowDefinitionId,
    workflowAttempt: context.workflowAttempt,
    classification: context.classification,
    acceptanceCriteria: context.acceptanceCriteria,
    commitSha: "a".repeat(40),
    pullRequest: { number: 12, url: "https://github.com/equipe/alvo/pull/12", state: "OPEN" },
    workspace: "/runner/project",
    round: 1,
    files: {
      "src/orders/total.ts": 20,
      "tests/existing.test.ts": 30,
      "tests/quantity.test.ts": 30,
    },
    test: {
      path: "tests/quantity.test.ts",
      frozenSha256: "c".repeat(64),
      finalSha256: "c".repeat(64),
    },
    validation: {
      baseline: { exitCode: 0, timedOut: false, report: vitestReport([baseline]) },
      regression: { exitCode: 1, timedOut: false, report: vitestReport([regression]) },
      final: { exitCode: 0, timedOut: false, report: vitestReport([baseline, fixed]) },
    },
    runReport: {
      schemaVersion: 1,
      executionId: context.executionId,
      phase: "fix",
      round: 1,
      outcome: "ready",
      summary: "Quantidade corrigida.",
      diagnosis: "O cálculo ignorava a quantidade.",
      references: [{ path: "src/orders/total.ts", startLine: 1, endLine: 3 }],
      questions: [],
      regressionTestPaths: ["tests/quantity.test.ts"],
      expectedFailure: {
        path: "tests/quantity.test.ts",
        summary: "Deve multiplicar a quantidade.",
      },
    },
  };
}
