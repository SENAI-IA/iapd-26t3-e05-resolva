import { readFile } from "node:fs/promises";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import { z } from "zod";
import type { ConfiguredCommand } from "../config/project.js";
import { runCommand } from "./process.js";
import type { Workspace } from "./workspace.js";

const assertionSchema = z.object({
  status: z.string().min(1),
  title: z.string().optional(),
  fullName: z.string().optional(),
  ancestorTitles: z.array(z.string()).optional(),
  failureMessages: z.array(z.string()).optional(),
});
const testFileSchema = z.object({
  name: z.string().optional(),
  assertionResults: z.array(assertionSchema).default([]),
  failureMessage: z.string().optional(),
  message: z.string().optional(),
});
const vitestReportSchema = z
  .object({
    numTotalTests: z.number().int().nonnegative(),
    numPassedTests: z.number().int().nonnegative(),
    numFailedTests: z.number().int().nonnegative(),
    numPendingTests: z.number().int().nonnegative(),
    testResults: z.array(testFileSchema),
  })
  .passthrough()
  .superRefine((report, context) => {
    if (
      report.numPassedTests + report.numFailedTests + report.numPendingTests >
      report.numTotalTests
    )
      context.addIssue({ code: "custom", message: "Contagem de testes inconsistente." });
  });

export type ValidationStatus = "passed" | "assertion_failed" | "runner_failed" | "zero_tests";

export interface ValidationResult {
  status: ValidationStatus;
  total: number;
  passed: number;
  failed: number;
  errors: readonly string[];
  failedTests: readonly string[];
}

export interface ValidationProcessResult {
  exitCode: number | null;
  timedOut?: boolean;
  report: string | null;
  errorOutput?: string;
}

export class ValidationReportError extends Error {
  constructor() {
    super("Relatório de testes inválido.");
    this.name = "ValidationReportError";
  }
}

function assertionName(
  file: z.infer<typeof testFileSchema>,
  assertion: z.infer<typeof assertionSchema>,
) {
  const parts = [
    file.name,
    ...(assertion.ancestorTitles ?? []),
    assertion.fullName ?? assertion.title,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" > ") || "Teste sem identificação";
}

export function parseVitestJson(raw: string): ValidationResult {
  try {
    const report = vitestReportSchema.parse(JSON.parse(raw));
    const failedTests: string[] = [];
    const errors: string[] = [];
    let runnerError = false;
    for (const file of report.testResults) {
      if (file.failureMessage || file.message) {
        runnerError = true;
        errors.push(file.failureMessage || file.message || "Falha no módulo de testes.");
      }
      for (const assertion of file.assertionResults) {
        if (assertion.status !== "failed") continue;
        failedTests.push(assertionName(file, assertion));
        errors.push(...(assertion.failureMessages ?? []));
      }
    }
    return {
      status: runnerError
        ? "runner_failed"
        : report.numTotalTests === 0
          ? "zero_tests"
          : report.numFailedTests > 0
            ? "assertion_failed"
            : "passed",
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      errors,
      failedTests,
    };
  } catch {
    throw new ValidationReportError();
  }
}

function runnerFailure(error: string): ValidationResult {
  return {
    status: "runner_failed",
    total: 0,
    passed: 0,
    failed: 0,
    errors: [error],
    failedTests: [],
  };
}

function mergeResults(results: readonly ValidationResult[]): ValidationResult {
  const total = results.reduce((sum, result) => sum + result.total, 0);
  const passed = results.reduce((sum, result) => sum + result.passed, 0);
  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  const errors = results.flatMap((result) => result.errors);
  const failedTests = results.flatMap((result) => result.failedTests);
  const status = results.some((result) => result.status === "runner_failed")
    ? "runner_failed"
    : results.some((result) => result.status === "assertion_failed")
      ? "assertion_failed"
      : results.some((result) => result.status === "zero_tests")
        ? "zero_tests"
        : "passed";
  return { status, total, passed, failed, errors, failedTests };
}

function commandWorkingDirectory(workspace: Workspace, command: ConfiguredCommand) {
  if (isAbsolute(command.cwd)) throw new Error("Diretório de validação inválido.");
  const cwd = resolve(workspace.path, command.cwd);
  const difference = relative(workspace.path, cwd);
  if (difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference))
    throw new Error("Diretório de validação fora do workspace.");
  return cwd;
}

export async function runValidation(
  workspace: Workspace,
  commands: readonly ConfiguredCommand[],
): Promise<ValidationResult> {
  if (commands.length === 0) throw new Error("Nenhum comando de validação configurado.");
  const reportPath = join(workspace.path, ".resolva", "validation-report.json");
  await mkdir(resolve(workspace.path, ".resolva"), { recursive: true });
  const results: ValidationResult[] = [];
  try {
    for (const command of commands) {
      const hasReportPlaceholder = command.args.some((arg) => arg.includes("{reportPath}"));
      if (command.kind === "test" && !hasReportPlaceholder)
        throw new Error("Comando de teste sem caminho de relatório.");
      await rm(reportPath, { force: true });
      const result = await runCommand({
        executable: command.executable,
        args: command.args.map((arg) => arg.replaceAll("{reportPath}", reportPath)),
        cwd: commandWorkingDirectory(workspace, command),
        timeoutMs: 300_000,
        maxOutputBytes: 10 * 1024 * 1024,
      });
      if (command.kind === "check") {
        if (result.failure || result.exitCode !== 0) {
          results.push(
            runnerFailure(result.stderr || result.stdout || "O comando de validação falhou."),
          );
          break;
        }
        results.push({
          status: "passed",
          total: 0,
          passed: 0,
          failed: 0,
          errors: [],
          failedTests: [],
        });
        continue;
      }
      let report: string | null = null;
      try {
        const content = await readFile(reportPath);
        if (content.byteLength > 64 * 1024) {
          results.push(runnerFailure("O relatório de testes excede o limite permitido."));
          break;
        }
        report = content.toString("utf8");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      try {
        const normalized = normalizeValidationResult({
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          report,
          errorOutput: result.stderr || result.stdout,
        });
        results.push(normalized);
        if (normalized.status === "runner_failed") break;
      } catch (error) {
        if (error instanceof ValidationReportError) {
          results.push(runnerFailure(error.message));
          break;
        }
        throw error;
      }
    }
  } finally {
    await rm(reportPath, { force: true });
  }
  return mergeResults(results);
}

export function normalizeValidationResult(output: ValidationProcessResult): ValidationResult {
  if (output.timedOut || output.exitCode === null)
    return {
      status: "runner_failed",
      total: 0,
      passed: 0,
      failed: 0,
      errors: ["O processo de testes não terminou no tempo limite."],
      failedTests: [],
    };
  if (output.report === null) {
    return {
      status: "runner_failed",
      total: 0,
      passed: 0,
      failed: 0,
      errors: output.errorOutput ? [output.errorOutput] : ["O runner não produziu um relatório."],
      failedTests: [],
    };
  }
  const result = parseVitestJson(output.report);
  if (result.status === "assertion_failed")
    return output.exitCode === 1 ? result : { ...result, status: "runner_failed" };
  if (output.exitCode !== 0) return { ...result, status: "runner_failed" };
  return result;
}
