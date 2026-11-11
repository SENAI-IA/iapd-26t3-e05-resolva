import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  classificationSchema,
  ticketVersionSchema,
  triageSourcePathSchema,
} from "../../domain/contracts.js";
import { classifyTriage } from "../../domain/triage.js";
import { triageReportSchema } from "../../domain/triageContracts.js";
import { triagePromptVersion, type TriageIdentity, type TriageSource } from "./triagePrompt.js";

const maxReportBytes = 64 * 1024;
const wireReportSchema = triageReportSchema.safeExtend({
  schemaVersion: z.literal(1),
  executionId: z.uuid(),
  ticketId: ticketVersionSchema.shape.ticketId,
  ticketVersion: ticketVersionSchema.shape.expectedVersion,
  kind: z.literal("triage"),
  phase: z.literal("triage"),
  round: z.literal(0),
  classification: classificationSchema,
  summary: triageReportSchema.shape.summary.max(2000),
  references: triageReportSchema.shape.references.max(20),
  promptVersion: z.literal(triagePromptVersion),
});

export function containsSecret(value: string, secrets: readonly string[]): boolean {
  return secrets.some(
    (secret) =>
      secret.length > 0 &&
      (value.includes(secret) || value.includes(JSON.stringify(secret).slice(1, -1))),
  );
}

export async function readTriageReport(
  path: string,
  identity: TriageIdentity,
  sources: readonly TriageSource[],
  secrets: readonly string[],
) {
  try {
    if ((await realpath(dirname(path))) !== dirname(path)) throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let raw: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxReportBytes) throw new Error();
      const chunks: Buffer[] = [];
      for await (const chunk of file.createReadStream({ end: maxReportBytes, autoClose: false })) {
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length > maxReportBytes) throw new Error();
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      await file.close();
    }
    const result = wireReportSchema.parse(JSON.parse(raw));
    if (containsSecret(JSON.stringify(result), secrets)) throw new Error();
    const manifest = new Map(sources.map((source) => [source.path, source]));
    if (
      result.executionId !== identity.executionId ||
      result.ticketId !== identity.ticketId ||
      result.ticketVersion !== identity.ticketVersion ||
      !["not_run", "unavailable"].includes(result.evidence.verificationStatus) ||
      result.classification !== classifyTriage(result.evidence).classification ||
      (result.classification !== "inconclusivo" && result.references.length === 0) ||
      result.evidence.sources.some(({ path, sha256 }) => manifest.get(path)?.sha256 !== sha256) ||
      result.references.some(({ path, endLine }) => endLine > (manifest.get(path)?.lineCount ?? 0))
    )
      throw new Error();
    return triageReportSchema.strip().parse(result);
  } catch {
    throw new Error("Relatório de triagem inválido.");
  }
}

export const implementationReportPhaseSchema = z.enum(["analysis", "regression", "fix"]);
export const runReportIdentitySchema = z.strictObject({
  executionId: z.uuid(),
  phase: implementationReportPhaseSchema,
  round: z.number().int().nonnegative().max(3),
});
export type RunReportIdentity = z.infer<typeof runReportIdentitySchema>;

const runReportReferenceSchema = z.strictObject({
  path: triageSourcePathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
const expectedFailureSchema = z.strictObject({
  path: triageSourcePathSchema,
  summary: z.string().trim().min(1).max(5000),
});
const runReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionId: z.uuid(),
  phase: implementationReportPhaseSchema,
  round: z.number().int().nonnegative().max(3),
  outcome: z.enum(["ready", "needs_information", "unsupported"]),
  summary: z.string().trim().min(1).max(2000),
  diagnosis: z.string().trim().min(1).max(10000),
  references: z.array(runReportReferenceSchema).max(20),
  questions: z.array(z.string().trim().min(1).max(10000)).max(5),
  regressionTestPaths: z.array(triageSourcePathSchema).max(20),
  expectedFailure: expectedFailureSchema.nullable(),
});
export type RunReport = z.infer<typeof runReportSchema>;

export function parseRunReport(
  value: unknown,
  expected: RunReportIdentity,
  context: {
    files: Readonly<Record<string, number>>;
    testPaths: readonly string[];
  },
): RunReport {
  try {
    const report = runReportSchema.parse(value);
    runReportIdentitySchema.parse(expected);
    if (
      report.executionId !== expected.executionId ||
      report.phase !== expected.phase ||
      report.round !== expected.round
    )
      throw new Error();
    if (
      (expected.phase === "analysis" && expected.round !== 0) ||
      (expected.phase === "regression" && expected.round !== 0) ||
      (expected.phase === "fix" && (expected.round < 1 || expected.round > 3))
    )
      throw new Error();
    for (const reference of report.references) {
      const lineCount = context.files[reference.path];
      if (
        lineCount === undefined ||
        reference.startLine > reference.endLine ||
        reference.endLine > lineCount
      )
        throw new Error();
    }
    for (const path of report.regressionTestPaths) {
      if (
        context.files[path] === undefined ||
        !context.testPaths.some((root) => path === root || path.startsWith(`${root}/`))
      )
        throw new Error();
    }
    if (report.outcome === "needs_information") {
      if (
        report.questions.length === 0 ||
        report.expectedFailure !== null ||
        report.regressionTestPaths.length > 0
      )
        throw new Error();
    } else {
      if (report.questions.length > 0) throw new Error();
      if (report.outcome === "unsupported" && report.expectedFailure !== null) throw new Error();
      if (report.outcome === "ready" && report.references.length === 0) throw new Error();
      if (
        report.outcome === "ready" &&
        (expected.phase === "regression" || expected.phase === "fix") &&
        (report.regressionTestPaths.length === 0 || report.expectedFailure === null)
      )
        throw new Error();
    }
    return report;
  } catch {
    throw new Error("Relatório de execução inválido.");
  }
}
