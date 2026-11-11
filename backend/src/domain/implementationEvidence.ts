import { createHash } from "node:crypto";
import { z } from "zod";
import { triageSourcePathSchema } from "./contracts.js";
import {
  gitShaSchema,
  githubRunIdSchema,
  githubNumberSchema,
} from "../integrations/github/contracts.js";

const testResultSchema = z
  .strictObject({
    status: z.enum(["passed", "assertion_failed"]),
    total: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.passed + value.failed === value.total &&
      (value.status === "passed" ? value.failed === 0 : value.failed > 0),
  );
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const implementationEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    executionId: z.uuid(),
    deliveryId: z.uuid(),
    workflowId: githubRunIdSchema,
    workflowDefinitionId: githubRunIdSchema,
    workflowAttempt: githubNumberSchema,
    commitSha: gitShaSchema,
    classification: z.enum(["bug", "melhoria"]),
    baseline: testResultSchema,
    regression: testResultSchema,
    final: testResultSchema,
    test: z.strictObject({
      path: triageSourcePathSchema,
      frozenSha256: hashSchema,
      finalSha256: hashSchema,
    }),
    report: z.strictObject({
      relativePath: triageSourcePathSchema,
      sha256: hashSchema,
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(64 * 1024),
    }),
  })
  .refine(
    (value) =>
      value.baseline.status === "passed" &&
      value.final.status === "passed" &&
      value.final.total > value.baseline.total &&
      value.test.frozenSha256 === value.test.finalSha256 &&
      value.regression.status === (value.classification === "bug" ? "assertion_failed" : "passed"),
  );
export type ImplementationEvidence = z.infer<typeof implementationEvidenceSchema>;

export function evidenceFingerprint(evidence: ImplementationEvidence) {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
