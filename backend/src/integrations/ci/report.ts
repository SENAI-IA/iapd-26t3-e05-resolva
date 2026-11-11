import { createHash } from "node:crypto";
import { z } from "zod";
import { hasControlCharacters } from "../../config/strings.js";
import {
  implementationEvidenceSchema,
  type ImplementationEvidence,
} from "../../domain/implementationEvidence.js";
import { triageSourcePathSchema } from "../../domain/contracts.js";
import {
  githubBranchSchema,
  githubNumberSchema,
  githubRepositorySchema,
  githubRunIdSchema,
  gitShaSchema,
  sameRepository,
} from "../github/contracts.js";
import { normalizeValidationResult } from "../../executor/validation.js";
import { containsSecret, parseRunReport } from "../kiro/report.js";
import { parsePipelineCallback, type PipelineCallback } from "./callback.js";

export interface PipelineReportContext {
  executionId: string;
  deliveryId: string;
  ticketId: number;
  ticketVersion: number;
  triageId: string;
  configHash: string;
  repository: string;
  branchName: string;
  workflowId: string;
  workflowDefinitionId: string;
  workflowAttempt: number;
  classification: "bug" | "melhoria";
  acceptanceCriteria: readonly string[];
  testPaths: readonly string[];
  allowedPaths: readonly string[];
  documentationPaths: readonly string[];
  maxRounds: number;
}
export interface PipelineReportSource {
  artifactId: string;
  archiveSha256: string;
}
export interface ParsedPipelineReport {
  content: Buffer;
  evidence: ImplementationEvidence;
  callback: PipelineCallback;
}

const count = z.number().int().nonnegative();
const assertionSchema = z
  .object({
    status: z.enum(["passed", "failed", "pending", "skipped", "todo", "disabled"]),
    title: z.string().max(2000).optional(),
    fullName: z.string().max(2000).optional(),
    ancestorTitles: z.array(z.string().max(2000)).max(20).default([]),
    failureMessages: z.array(z.string().max(10000)).max(20).default([]),
  })
  .refine((value) => Boolean((value.fullName ?? value.title)?.trim()));
const vitestSchema = z.object({
  numTotalTests: count,
  numPassedTests: count,
  numFailedTests: count,
  numPendingTests: count,
  numTodoTests: count.default(0),
  success: z.boolean(),
  testResults: z
    .array(
      z.object({
        name: z.string().min(1).max(2048),
        status: z.enum(["passed", "failed"]),
        message: z.string().max(10000).default(""),
        failureMessage: z.string().max(10000).default(""),
        assertionResults: z.array(assertionSchema).max(1000),
      }),
    )
    .max(1000),
});
const processSchema = z.strictObject({
  exitCode: z.number().int().min(0).max(255).nullable(),
  timedOut: z.boolean(),
  report: vitestSchema,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceSchema = z.strictObject({ artifactId: githubRunIdSchema, archiveSha256: hash });
const wireSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionId: z.uuid(),
  deliveryId: z.uuid(),
  ticketId: githubNumberSchema,
  ticketVersion: githubNumberSchema,
  triageId: z.uuid(),
  configHash: hash,
  repository: githubRepositorySchema,
  branchName: githubBranchSchema,
  workflowId: githubRunIdSchema,
  workflowDefinitionId: githubRunIdSchema,
  workflowAttempt: githubNumberSchema,
  classification: z.enum(["bug", "melhoria"]),
  acceptanceCriteria: z.array(z.string().min(1).max(10000)).max(50),
  commitSha: gitShaSchema,
  pullRequest: z.strictObject({
    number: githubNumberSchema,
    url: z.url(),
    state: z.literal("OPEN"),
  }),
  workspace: z
    .string()
    .max(2048)
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.includes("\\") &&
        !hasControlCharacters(value) &&
        value
          .slice(1)
          .split("/")
          .every((part) => part && part !== "." && part !== ".."),
    ),
  round: z.number().int().min(1).max(3),
  files: z
    .record(triageSourcePathSchema, z.number().int().nonnegative().max(100000))
    .refine((value) => Object.keys(value).length <= 1000),
  test: implementationEvidenceSchema.shape.test,
  validation: z.strictObject({
    baseline: processSchema,
    regression: processSchema,
    final: processSchema,
  }),
  runReport: z.unknown(),
  source: sourceSchema.optional(),
});

function inRoots(path: string, roots: readonly string[]) {
  return roots.some((root) => path.startsWith(`${root}/`));
}
function caseName(assertion: z.infer<typeof assertionSchema>) {
  return [...assertion.ancestorTitles, assertion.fullName ?? assertion.title].join(" > ");
}
function pathSafe(path: string) {
  return path
    .split("/")
    .every(
      (part) =>
        ![
          ".git",
          ".github",
          ".env",
          ".aws",
          ".ssh",
          ".kiro",
          ".codex",
          ".agents",
          "node_modules",
        ].includes(part.toLowerCase()) && !part.toLowerCase().startsWith(".env."),
    );
}
function checkReport(
  process: z.infer<typeof processSchema>,
  workspace: string,
  context: PipelineReportContext,
  files: Record<string, number>,
) {
  const report = process.report;
  const seenFiles = new Set<string>();
  const cases = new Set<string>();
  const failedPaths: string[] = [];
  let passed = 0;
  let failed = 0;
  for (const file of report.testResults) {
    const path = triageSourcePathSchema.parse(
      file.name.startsWith(`${workspace}/`) ? file.name.slice(workspace.length + 1) : file.name,
    );
    if (
      !inRoots(path, context.testPaths) ||
      files[path] === undefined ||
      !pathSafe(path) ||
      seenFiles.has(path) ||
      file.message ||
      file.failureMessage ||
      file.assertionResults.length === 0
    )
      throw new Error();
    seenFiles.add(path);
    file.name = path;
    let fileFailed = false;
    for (const assertion of file.assertionResults) {
      const key = `${path}\u0000${caseName(assertion)}`;
      if (cases.has(key)) throw new Error();
      cases.add(key);
      if (assertion.status === "passed") {
        passed++;
        if (assertion.failureMessages.length) throw new Error();
      } else if (assertion.status === "failed") {
        failed++;
        fileFailed = true;
        failedPaths.push(path);
        if (!assertion.failureMessages.some((message) => message.trim())) throw new Error();
      } else throw new Error();
    }
    if (file.status !== (fileFailed ? "failed" : "passed")) throw new Error();
  }
  if (
    passed + failed === 0 ||
    report.numTotalTests !== passed + failed ||
    report.numPassedTests !== passed ||
    report.numFailedTests !== failed ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    report.success !== (failed === 0)
  )
    throw new Error();
  const normalized = normalizeValidationResult({
    exitCode: process.exitCode,
    timedOut: process.timedOut,
    report: JSON.stringify(report),
  });
  if (normalized.status !== "passed" && normalized.status !== "assertion_failed") throw new Error();
  return {
    result: {
      status: normalized.status,
      total: normalized.total,
      passed: normalized.passed,
      failed: normalized.failed,
    },
    cases,
    failedPaths,
    paths: seenFiles,
  };
}
function redact(value: string, secrets: readonly string[]) {
  return [...new Set(secrets)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
}

export function parsePipelineReport(
  content: Buffer,
  context: PipelineReportContext,
  secretValues: readonly string[] = [],
  source?: PipelineReportSource,
): ParsedPipelineReport {
  try {
    if (content.length < 1 || content.length > 64 * 1024) throw new Error();
    const value = wireSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
    );
    if (
      value.executionId !== context.executionId ||
      value.deliveryId !== context.deliveryId ||
      value.ticketId !== context.ticketId ||
      value.ticketVersion !== context.ticketVersion ||
      value.triageId !== context.triageId ||
      value.configHash !== context.configHash ||
      !sameRepository(value.repository, context.repository) ||
      value.branchName !== context.branchName ||
      value.workflowId !== context.workflowId ||
      value.workflowDefinitionId !== context.workflowDefinitionId ||
      value.workflowAttempt !== context.workflowAttempt ||
      value.classification !== context.classification ||
      JSON.stringify(value.acceptanceCriteria) !== JSON.stringify(context.acceptanceCriteria) ||
      value.round > context.maxRounds
    )
      throw new Error();
    const files = Object.fromEntries(
      Object.keys(value.files)
        .sort()
        .map((path) => [path, value.files[path]!]),
    );
    if (
      Object.keys(files).some(
        (path) =>
          !pathSafe(path) ||
          !inRoots(path, [...context.allowedPaths, ...context.documentationPaths]),
      ) ||
      !inRoots(value.test.path, context.testPaths) ||
      !files[value.test.path]
    )
      throw new Error();
    const baseline = checkReport(value.validation.baseline, value.workspace, context, files);
    const regression = checkReport(value.validation.regression, value.workspace, context, files);
    const final = checkReport(value.validation.final, value.workspace, context, files);
    if (
      baseline.result.status !== "passed" ||
      final.result.status !== "passed" ||
      baseline.paths.has(value.test.path) ||
      !regression.paths.has(value.test.path) ||
      !final.paths.has(value.test.path) ||
      [...baseline.cases, ...regression.cases].some((key) => !final.cases.has(key)) ||
      (context.classification === "bug"
        ? regression.result.status !== "assertion_failed" ||
          regression.failedPaths.some((path) => path !== value.test.path)
        : regression.result.status !== "passed")
    )
      throw new Error();
    const report = parseRunReport(
      value.runReport,
      { executionId: context.executionId, phase: "fix", round: value.round },
      { files, testPaths: context.testPaths, classification: context.classification },
    );
    if (
      report.outcome !== "ready" ||
      report.regressionTestPaths.length !== 1 ||
      report.regressionTestPaths[0] !== value.test.path ||
      (report.expectedFailure !== null && report.expectedFailure.path !== value.test.path)
    )
      throw new Error();
    const prUrl = `https://github.com/${context.repository}/pull/${value.pullRequest.number}`;
    if (value.pullRequest.url.toLowerCase() !== prUrl.toLowerCase()) throw new Error();
    const callback = parsePipelineCallback(
      {
        schemaVersion: 1,
        executionId: context.executionId,
        repository: context.repository,
        workflowId: context.workflowId,
        workflowUrl: `https://github.com/${context.repository}/actions/runs/${context.workflowId}`,
        status: "success",
        branch: value.branchName,
        commitSha: value.commitSha,
        pullRequest: { ...value.pullRequest, url: prUrl },
        failureReason: null,
      },
      { executionId: context.executionId, repository: context.repository },
    );
    const critical = {
      ...context,
      files: Object.keys(files),
      test: value.test,
      commitSha: value.commitSha,
      callback,
      assertions: Object.values(value.validation).flatMap((process) =>
        process.report.testResults.flatMap((file) =>
          file.assertionResults.map((assertion) => [
            file.name,
            assertion.title,
            assertion.fullName,
            assertion.ancestorTitles,
          ]),
        ),
      ),
    };
    if (containsSecret(JSON.stringify(critical), secretValues)) throw new Error();
    report.summary = redact(report.summary, secretValues);
    report.diagnosis = redact(report.diagnosis, secretValues);
    if (report.expectedFailure)
      report.expectedFailure.summary = redact(report.expectedFailure.summary, secretValues);
    for (const process of Object.values(value.validation))
      for (const file of process.report.testResults)
        for (const assertion of file.assertionResults)
          assertion.failureMessages = assertion.failureMessages.map((message) =>
            redact(message, secretValues),
          );
    const normalized = {
      ...value,
      repository: context.repository,
      workspace: "/workspace",
      files,
      pullRequest: { ...value.pullRequest, url: prUrl },
      runReport: report,
      source: source ? sourceSchema.parse(source) : value.source,
    };
    const clean = Buffer.from(JSON.stringify(normalized));
    if (clean.length > 64 * 1024 || containsSecret(clean.toString("utf8"), secretValues))
      throw new Error();
    const sha256 = createHash("sha256").update(clean).digest("hex");
    const evidence = implementationEvidenceSchema.parse({
      schemaVersion: 1,
      executionId: context.executionId,
      deliveryId: context.deliveryId,
      workflowId: context.workflowId,
      workflowDefinitionId: context.workflowDefinitionId,
      workflowAttempt: context.workflowAttempt,
      commitSha: value.commitSha,
      classification: value.classification,
      baseline: baseline.result,
      regression: regression.result,
      final: final.result,
      test: value.test,
      report: {
        relativePath: `${context.executionId}/validation-${sha256}.json`,
        sha256,
        sizeBytes: clean.length,
      },
    });
    return { content: clean, evidence, callback };
  } catch {
    throw new Error("Relatório da pipeline inválido.");
  }
}
