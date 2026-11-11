import { createHash } from "node:crypto";
import { z } from "zod";
import type { GhOutput } from "./cli.js";
import { githubNumberSchema, githubRepositorySchema, githubRunIdSchema } from "./contracts.js";
import { GithubCliError } from "./error.js";
import { readReportArchive } from "./reportArchive.js";

export const maximumReportArchiveBytes = 256 * 1024;
export type PipelineReportDownloadInput = {
  repository: string;
  executionId: string;
  workflowId: string;
  workflowAttempt: number;
};
const inputSchema = z.object({
  repository: githubRepositorySchema,
  executionId: z.uuid(),
  workflowId: githubRunIdSchema,
  workflowAttempt: githubNumberSchema,
});
const artifactListSchema = z.object({
  total_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  artifacts: z.array(
    z.object({
      id: githubNumberSchema,
      name: z.string(),
      expired: z.literal(false),
      size_in_bytes: githubNumberSchema.max(maximumReportArchiveBytes),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      workflow_run: z.object({ id: githubNumberSchema }),
    }),
  ),
});
const invalidResponse = () =>
  new GithubCliError("invalid_response", "O artefato de relatório do GitHub é inválido.");

function transportError(error: unknown) {
  const reason = error instanceof GithubCliError ? error.reason : "failed";
  const messages = {
    timeout: "O download do relatório excedeu o tempo limite.",
    unavailable: "O executável gh não está instalado.",
    failed: "O GitHub não pôde fornecer o relatório.",
    invalid_response: "O artefato de relatório do GitHub é inválido.",
  };
  return new GithubCliError(reason, messages[reason]);
}

export function createGithubArtifacts(
  run: (args: readonly string[]) => Promise<GhOutput>,
  runBinary: (args: readonly string[]) => Promise<{ stdout: Buffer; stderr: string }>,
) {
  return {
    async downloadPipelineReport(input: PipelineReportDownloadInput): Promise<{
      artifactId: string;
      archiveSha256: string;
      content: Buffer;
    } | null> {
      const validated = inputSchema.safeParse(input);
      if (!validated.success) throw invalidResponse();
      const { repository, executionId, workflowId, workflowAttempt } = validated.data;
      const name = `resolva-report-${executionId}-${workflowAttempt}`;
      const args = ["api", "--hostname", "github.com", "--method", "GET"];
      let output: GhOutput;
      try {
        output = await run([
          ...args,
          `repos/${repository}/actions/runs/${workflowId}/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
        ]);
      } catch (error) {
        throw transportError(error);
      }
      let artifact;
      try {
        const list = artifactListSchema.parse(JSON.parse(output.stdout));
        if (list.total_count !== list.artifacts.length || list.total_count > 1)
          throw invalidResponse();
        if (list.total_count === 0) return null;
        artifact = list.artifacts[0]!;
        if (artifact.name !== name || String(artifact.workflow_run.id) !== workflowId)
          throw invalidResponse();
      } catch {
        throw invalidResponse();
      }
      let archive: Buffer;
      try {
        archive = (
          await runBinary([...args, `repos/${repository}/actions/artifacts/${artifact.id}/zip`])
        ).stdout;
      } catch (error) {
        throw transportError(error);
      }
      if (
        !Buffer.isBuffer(archive) ||
        archive.length === 0 ||
        archive.length > maximumReportArchiveBytes ||
        archive.length !== artifact.size_in_bytes
      )
        throw invalidResponse();
      const archiveSha256 = createHash("sha256").update(archive).digest("hex");
      if (`sha256:${archiveSha256}` !== artifact.digest) throw invalidResponse();
      const content = await readReportArchive(archive);
      return { artifactId: String(artifact.id), archiveSha256, content };
    },
  };
}
