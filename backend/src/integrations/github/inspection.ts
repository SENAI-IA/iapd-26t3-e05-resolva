import { z } from "zod";
import type { GhOutput } from "./cli.js";
import {
  githubBranchSchema,
  githubNumberSchema,
  githubRepositorySchema,
  githubRunIdSchema,
  gitShaSchema,
  sameRepository,
  githubWorkflowFileSchema,
  githubWorkflowSelectorSchema,
} from "./contracts.js";
import { GithubCliError } from "./error.js";

const repositorySchema = z.object({ full_name: githubRepositorySchema });
const workflowRunSchema = z.object({
  id: githubNumberSchema,
  html_url: z.url(),
  workflow_id: githubNumberSchema,
  run_attempt: githubNumberSchema,
  event: z.string().min(1).max(100),
  status: z.enum(["queued", "in_progress", "requested", "waiting", "pending", "completed"]),
  conclusion: z
    .enum([
      "success",
      "failure",
      "neutral",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
      "stale",
      "startup_failure",
    ])
    .nullable(),
  head_branch: githubBranchSchema.nullable(),
  head_sha: gitShaSchema,
  repository: repositorySchema,
  display_title: z.string().max(1000),
  created_at: z.iso.datetime({ offset: true }),
});
const pullRequestSchema = z
  .object({
    number: githubNumberSchema,
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean(),
    draft: z.boolean(),
    body: z.string().max(65536).nullable(),
    head: z.object({ ref: githubBranchSchema, sha: gitShaSchema, repo: repositorySchema }),
    base: z.object({ ref: githubBranchSchema, repo: repositorySchema }),
  })
  .refine((value) => !value.merged || value.state === "closed");
const branchHeadSchema = z.object({
  ref: z.string(),
  object: z.object({ type: z.literal("commit"), sha: gitShaSchema }),
});

function parseResponse<T>(stdout: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(stdout));
  } catch {
    throw new GithubCliError(
      "invalid_response",
      "A resposta do GitHub não tem o formato esperado.",
    );
  }
}

export function createGithubInspection(run: (args: readonly string[]) => Promise<GhOutput>) {
  const get = (endpoint: string) =>
    run(["api", "--hostname", "github.com", "--method", "GET", endpoint]);
  return {
    async getWorkflowDefinition(input: { repository: string; workflow: string }) {
      const repository = githubRepositorySchema.parse(input.repository);
      const selector = githubWorkflowSelectorSchema.parse(input.workflow);
      const workflow = selector.replace(/^\.github\/workflows\//u, "");
      const result = await get(
        `repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}`,
      );
      return parseResponse(result.stdout, (value) => {
        const data = z
          .object({
            id: githubNumberSchema,
            path: githubWorkflowFileSchema,
            state: z.string().min(1).max(100),
            url: z.url(),
          })
          .parse(value);
        if (
          (/^[0-9]+$/u.test(workflow)
            ? String(data.id) !== workflow
            : data.path !== `.github/workflows/${workflow}`) ||
          data.url.toLowerCase() !==
            `https://api.github.com/repos/${repository}/actions/workflows/${data.id}`.toLowerCase()
        )
          throw new Error();
        return { id: String(data.id), path: data.path, state: data.state };
      });
    },
    async getWorkflowRun(input: { repository: string; workflowId: string }) {
      const repository = githubRepositorySchema.parse(input.repository);
      const workflowId = githubRunIdSchema.parse(input.workflowId);
      const result = await get(`repos/${repository}/actions/runs/${workflowId}`);
      return parseResponse(result.stdout, (value) => {
        const data = workflowRunSchema.parse(value);
        if (
          String(data.id) !== workflowId ||
          !sameRepository(data.repository.full_name, repository) ||
          data.html_url !==
            `https://github.com/${data.repository.full_name}/actions/runs/${workflowId}`
        )
          throw new Error();
        return {
          id: String(data.id),
          url: data.html_url,
          workflowDefinitionId: String(data.workflow_id),
          attempt: data.run_attempt,
          event: data.event,
          status: data.status,
          conclusion: data.conclusion,
          headBranch: data.head_branch,
          headSha: data.head_sha,
          repository: data.repository.full_name,
          displayTitle: data.display_title,
          createdAt: new Date(data.created_at).toISOString(),
        };
      });
    },
    async getPullRequest(input: { repository: string; number: number }) {
      const repository = githubRepositorySchema.parse(input.repository);
      const number = githubNumberSchema.parse(input.number);
      const result = await get(`repos/${repository}/pulls/${number}`);
      return parseResponse(result.stdout, (value) => {
        const data = pullRequestSchema.parse(value);
        if (
          data.number !== number ||
          !sameRepository(data.base.repo.full_name, repository) ||
          data.html_url !== `https://github.com/${data.base.repo.full_name}/pull/${number}`
        )
          throw new Error();
        return {
          number: data.number,
          url: data.html_url,
          state: data.merged
            ? ("MERGED" as const)
            : data.state === "open"
              ? ("OPEN" as const)
              : ("CLOSED" as const),
          draft: data.draft,
          body: data.body ?? "",
          headRefName: data.head.ref,
          baseRefName: data.base.ref,
          headSha: data.head.sha,
          headRepository: data.head.repo.full_name,
          baseRepository: data.base.repo.full_name,
        };
      });
    },
    async getBranchHead(input: { repository: string; branch: string }) {
      const repository = githubRepositorySchema.parse(input.repository);
      const branch = githubBranchSchema.parse(input.branch);
      const result = await get(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`);
      return parseResponse(result.stdout, (value) => {
        const data = branchHeadSchema.parse(value);
        if (data.ref !== `refs/heads/${branch}`) throw new Error();
        return data.object.sha;
      });
    },
  };
}

export type GithubWorkflowRun = Awaited<
  ReturnType<ReturnType<typeof createGithubInspection>["getWorkflowRun"]>
>;
