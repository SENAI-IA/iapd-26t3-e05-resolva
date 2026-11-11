import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { hasControlCharacters } from "../../config/strings.js";
import { githubRepositorySchema, githubBranchSchema } from "./contracts.js";
import { GithubCliError } from "./error.js";
import { createGithubInspection } from "./inspection.js";
import { createGithubArtifacts, maximumReportArchiveBytes } from "./artifacts.js";
import { confirmDelivery, type DeliveryConfirmationInput } from "./confirmation.js";

export { GithubCliError } from "./error.js";

const execFileAsync = promisify(execFile);
const pullRequestSchema = z.strictObject({
  number: z.number().int().positive(),
  url: z.url().refine((value) => new URL(value).hostname === "github.com"),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
});

export type PullRequestReference = z.infer<typeof pullRequestSchema>;
export type GhExecution = (
  args: readonly string[],
  options: GhExecutionOptions,
) => Promise<GhOutput>;
export type GhBinaryExecution = (
  args: readonly string[],
  options: GhExecutionOptions,
) => Promise<{ stdout: Buffer; stderr: string }>;
export type GhExecutionOptions = {
  cwd?: string;
  timeoutMs: number;
  token?: string;
};
export type GhOutput = { stdout: string; stderr: string };

function environment(token?: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...(token ? { GH_TOKEN: token } : {}),
  };
}

const defaultExecution: GhExecution = async (args, options) => {
  try {
    const result = await execFileAsync("gh", [...args], {
      cwd: options.cwd,
      env: environment(options.token),
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof Error && "killed" in error && error.killed)
      throw new GithubCliError("timeout", "O comando gh excedeu o tempo limite.");
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new GithubCliError("unavailable", "O executável gh não está instalado.");
    throw new GithubCliError("failed", "O comando gh não pôde concluir a operação.");
  }
};

const defaultBinaryExecution: GhBinaryExecution = async (args, options) => {
  try {
    const result = await execFileAsync("gh", [...args], {
      cwd: options.cwd,
      env: environment(options.token),
      timeout: options.timeoutMs,
      maxBuffer: maximumReportArchiveBytes,
      encoding: "buffer",
      shell: false,
    });
    return { stdout: result.stdout, stderr: result.stderr.toString("utf8") };
  } catch (error) {
    if (error instanceof Error && "killed" in error && error.killed)
      throw new GithubCliError("timeout", "O comando gh excedeu o tempo limite.");
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new GithubCliError("unavailable", "O executável gh não está instalado.");
    throw new GithubCliError("failed", "O comando gh não pôde concluir a operação.");
  }
};

function validateRepository(repository: string) {
  return githubRepositorySchema.parse(repository);
}

function validateBranch(branch: string) {
  return githubBranchSchema.parse(branch);
}

function parsePullRequests(stdout: string): PullRequestReference[] {
  try {
    return z.array(pullRequestSchema).parse(JSON.parse(stdout));
  } catch {
    throw new GithubCliError(
      "invalid_response",
      "A resposta do GitHub não tem o formato esperado.",
    );
  }
}

function outputUrl(stdout: string) {
  const value = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  const result = z
    .url()
    .refine((url) => new URL(url).hostname === "github.com")
    .safeParse(value);
  if (!result.success)
    throw new GithubCliError("invalid_response", "O GitHub não devolveu a URL do PR.");
  return result.data;
}

export type GithubClient = ReturnType<typeof createGithubClient>;

export function createGithubClient(
  options: {
    cwd?: string;
    token?: string;
    timeoutMs?: number;
    execute?: GhExecution;
    executeBinary?: GhBinaryExecution;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000)
    throw new Error("O timeout do gh deve estar entre 1 e 300 segundos.");
  const execute = options.execute ?? defaultExecution;
  const executeBinary =
    options.executeBinary ??
    (options.execute
      ? async () => {
          throw new GithubCliError("failed", "O executor binário do gh não foi configurado.");
        }
      : defaultBinaryExecution);
  const executionOptions: GhExecutionOptions = {
    timeoutMs,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.token ? { token: options.token } : {}),
  };
  const run = (args: readonly string[]) => execute(args, executionOptions);
  const inspection = createGithubInspection(run);

  return {
    ...inspection,
    ...createGithubArtifacts(run, (args) => executeBinary(args, executionOptions)),
    confirmDelivery(input: DeliveryConfirmationInput) {
      return confirmDelivery(input, inspection);
    },
    async checkAvailability() {
      try {
        await run(["--version"]);
      } catch (error) {
        if (error instanceof GithubCliError && error.reason === "unavailable")
          return { installed: false, authenticated: false };
        throw error;
      }
      try {
        await run(["auth", "status", "--hostname", "github.com"]);
        return { installed: true, authenticated: true };
      } catch (error) {
        if (error instanceof GithubCliError && error.reason === "failed")
          return { installed: true, authenticated: false };
        throw error;
      }
    },

    async listPullRequests(input: { repository: string; head: string }) {
      const repository = validateRepository(input.repository);
      const head = validateBranch(input.head);
      const result = await run([
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        head,
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        "number,url,state,headRefName,baseRefName",
      ]);
      return parsePullRequests(result.stdout);
    },

    async createOrReusePullRequest(input: {
      repository: string;
      head: string;
      base: string;
      title: string;
      body: string;
    }) {
      const repository = validateRepository(input.repository);
      const head = validateBranch(input.head);
      const base = validateBranch(input.base);
      const title = z.string().trim().min(1).max(255).parse(input.title);
      const body = z.string().max(20_000).parse(input.body);
      const existing = (await this.listPullRequests({ repository, head })).find(
        (pullRequest) => pullRequest.baseRefName === base,
      );
      if (existing) return existing;
      try {
        const result = await run([
          "pr",
          "create",
          "--repo",
          repository,
          "--head",
          head,
          "--base",
          base,
          "--title",
          title,
          "--body",
          body,
        ]);
        const url = outputUrl(result.stdout);
        return {
          number: null,
          url,
          state: "OPEN" as const,
          headRefName: head,
          baseRefName: base,
        };
      } catch (error) {
        const reconciled = (await this.listPullRequests({ repository, head })).find(
          (pullRequest) => pullRequest.baseRefName === base,
        );
        if (reconciled) return reconciled;
        throw error;
      }
    },

    async triggerWorkflow(input: {
      repository: string;
      workflow: string;
      ref: string;
      fields?: Readonly<Record<string, string>>;
    }) {
      const repository = validateRepository(input.repository);
      const workflow = z.string().trim().min(1).max(255).parse(input.workflow);
      const ref = validateBranch(input.ref);
      const args = ["workflow", "run", workflow, "--repo", repository, "--ref", ref];
      for (const [key, value] of Object.entries(input.fields ?? {})) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(key) || hasControlCharacters(value))
          throw new GithubCliError("failed", "Parâmetro de workflow inválido.");
        args.push("--field", `${key}=${value}`);
      }
      await run(args);
    },
  };
}
