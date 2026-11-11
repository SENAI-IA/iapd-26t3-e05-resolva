import { createHash } from "node:crypto";
import { z } from "zod";

const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const repositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);
const branchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\s\\~^:?*[\]]/u.test(value) && !value.includes(".."));
const pullRequestSchema = z.strictObject({
  number: z.number().int().positive(),
  url: z.url(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
});
export const pipelineCallbackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionId: z.uuid(),
  repository: repositorySchema,
  workflowId: z
    .string()
    .max(200)
    .regex(/^[1-9][0-9]*$/u),
  workflowUrl: z.url(),
  status: z.enum(["queued", "running", "success", "failure", "cancelled"]),
  branch: branchSchema.nullable(),
  commitSha: shaSchema.nullable(),
  pullRequest: pullRequestSchema.nullable(),
  failureReason: z.string().trim().min(1).max(10000).nullable(),
});

export type PipelineCallback = z.infer<typeof pipelineCallbackSchema>;
export type PipelineCallbackIdentity = { executionId: string; repository: string };

function githubUrl(value: string, repository: string, suffix: string) {
  return value === `https://github.com/${repository}/${suffix}`;
}

export function parsePipelineCallback(
  value: unknown,
  expected: PipelineCallbackIdentity,
): PipelineCallback {
  try {
    const callback = pipelineCallbackSchema.parse(value);
    if (
      callback.executionId !== expected.executionId ||
      callback.repository !== expected.repository ||
      !githubUrl(callback.workflowUrl, callback.repository, `actions/runs/${callback.workflowId}`)
    )
      throw new Error();
    if (
      callback.pullRequest &&
      !githubUrl(
        callback.pullRequest.url,
        callback.repository,
        `pull/${callback.pullRequest.number}`,
      )
    )
      throw new Error();
    if (callback.status === "success") {
      if (!callback.branch || !callback.commitSha || !callback.pullRequest) throw new Error();
      if (callback.pullRequest.state !== "OPEN") throw new Error();
      if (callback.failureReason !== null) throw new Error();
    } else if (callback.status === "failure" || callback.status === "cancelled") {
      if (callback.failureReason === null) throw new Error();
    } else if (callback.failureReason !== null) {
      throw new Error();
    }
    return callback;
  } catch {
    throw new Error("Callback da pipeline inválido.");
  }
}

export function pipelineCallbackFingerprint(callback: PipelineCallback) {
  return createHash("sha256").update(JSON.stringify(callback), "utf8").digest("hex");
}

export function isTerminalPipelineStatus(status: PipelineCallback["status"]) {
  return status === "success" || status === "failure" || status === "cancelled";
}
