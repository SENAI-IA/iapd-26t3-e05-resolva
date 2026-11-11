import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeValidationResult,
  parseVitestJson,
  runValidation,
  ValidationReportError,
} from "./validation.js";
import type { Workspace } from "./workspace.js";

function report(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [
      {
        name: "src/total.test.ts",
        assertionResults: [
          {
            status: "passed",
            title: "calcula o total",
            fullName: "calcula o total",
            ancestorTitles: [],
            failureMessages: [],
          },
          {
            status: "passed",
            title: "mantém centavos",
            fullName: "mantém centavos",
            ancestorTitles: [],
            failureMessages: [],
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe("adaptador vitest-json", () => {
  it("normaliza uma suíte aprovada", () => {
    expect(parseVitestJson(report())).toEqual({
      status: "passed",
      total: 2,
      passed: 2,
      failed: 0,
      errors: [],
      failedTests: [],
    });
  });

  it("identifica a asserção falha e preserva sua referência", () => {
    const result = parseVitestJson(
      report({
        numPassedTests: 1,
        numFailedTests: 1,
        testResults: [
          {
            name: "src/total.test.ts",
            assertionResults: [
              {
                status: "failed",
                title: "calcula quantidade",
                fullName: "calcula quantidade",
                ancestorTitles: ["total"],
                failureMessages: ["Esperado 2500, recebido 1500."],
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      status: "assertion_failed",
      total: 2,
      passed: 1,
      failed: 1,
      errors: ["Esperado 2500, recebido 1500."],
      failedTests: ["src/total.test.ts > total > calcula quantidade"],
    });
  });

  it("diferencia zero testes de falha do runner", () => {
    expect(parseVitestJson(report({ numTotalTests: 0, numPassedTests: 0 }))).toMatchObject({
      status: "zero_tests",
      total: 0,
    });
    expect(
      normalizeValidationResult({
        exitCode: 1,
        report: report({ numTotalTests: 0, numPassedTests: 0 }),
      }),
    ).toMatchObject({ status: "runner_failed" });
  });

  it("classifica timeout e ausência de relatório como falha do runner", () => {
    expect(
      normalizeValidationResult({ exitCode: null, timedOut: true, report: null }),
    ).toMatchObject({
      status: "runner_failed",
      total: 0,
    });
    expect(
      normalizeValidationResult({
        exitCode: 1,
        report: null,
        errorOutput: "erro de compilação",
      }),
    ).toEqual({
      status: "runner_failed",
      total: 0,
      passed: 0,
      failed: 0,
      errors: ["erro de compilação"],
      failedTests: [],
    });
  });

  it("recusa JSON ausente, inválido ou inconsistente", () => {
    expect(() => parseVitestJson("não é JSON")).toThrow(ValidationReportError);
    expect(() => parseVitestJson(JSON.stringify({}))).toThrow("Relatório de testes inválido.");
    expect(() => parseVitestJson(report({ numTotalTests: 1, numPassedTests: 2 }))).toThrow(
      ValidationReportError,
    );
  });
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(): Workspace {
  const path = mkdtempSync(join(tmpdir(), "resolva-validation-"));
  temporaryDirectories.push(path);
  mkdirSync(join(path, "reports"));
  return { path, sourceRoot: path, baseSha: "a".repeat(40) };
}

describe("execução de validação", () => {
  it("executa comando de teste sem shell e lê o relatório reservado", async () => {
    const report = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [],
    });
    const result = await runValidation(workspace(), [
      {
        id: "suite",
        executable: "node",
        args: [
          "-e",
          `require("node:fs").writeFileSync(process.argv[1], ${JSON.stringify(report)})`,
          "{reportPath}",
        ],
        cwd: ".",
        kind: "test",
      },
    ]);

    expect(result).toMatchObject({ status: "passed", total: 1, passed: 1 });
  });

  it("diferencia falha de comando de falha de asserção", async () => {
    const result = await runValidation(workspace(), [
      {
        id: "compilar",
        executable: "node",
        args: ["-e", "process.exit(2)"],
        cwd: ".",
        kind: "check",
      },
    ]);

    expect(result).toMatchObject({ status: "runner_failed", total: 0, failed: 0 });
  });
});
