import { spawn } from "node:child_process";

const minimumTimeoutMs = 1;
const maximumTimeoutMs = 3_600_000;
const minimumOutputBytes = 1;
const maximumOutputBytes = 10 * 1024 * 1024;
const terminationGraceMs = 250;

export interface CommandInput {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  env?: Readonly<Record<string, string>>;
  maxOutputBytes?: number;
}

export type CommandFailure = "spawn" | "timeout" | "output_limit" | null;

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  failure: CommandFailure;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function validateInput(input: CommandInput) {
  if (!input.executable || input.executable.includes("\0"))
    throw new Error("Executável de comando inválido.");
  if (!input.cwd || input.cwd.includes("\0")) throw new Error("Diretório de comando inválido.");
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < minimumTimeoutMs ||
    input.timeoutMs > maximumTimeoutMs
  )
    throw new Error("Tempo limite de comando inválido.");
  const maxOutputBytes = input.maxOutputBytes ?? maximumOutputBytes;
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < minimumOutputBytes ||
    maxOutputBytes > maximumOutputBytes
  )
    throw new Error("Limite de saída inválido.");
  return maxOutputBytes;
}

function terminateProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}

function appendLimited(target: Buffer[], chunk: Buffer, limit: number, currentSize: number) {
  const remaining = limit - currentSize;
  if (remaining <= 0) return { bytes: 0, exceeded: true };
  const accepted = chunk.subarray(0, remaining);
  target.push(accepted);
  return { bytes: accepted.length, exceeded: chunk.length > remaining };
}

export function runCommand(input: CommandInput): Promise<CommandResult> {
  const maxOutputBytes = validateInput(input);
  const startedAt = Date.now();
  const environment = {
    PATH: input.env?.PATH ?? process.env.PATH ?? "",
    ...input.env,
  };
  return new Promise((resolve) => {
    let timedOut = false;
    let outputLimitExceeded = false;
    let failure: CommandFailure = null;
    let spawnError = false;
    let capturedOutputBytes = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: environment,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stop = (reason: Exclude<CommandFailure, null>) => {
      if (failure) return;
      failure = reason;
      if (reason === "timeout") timedOut = true;
      if (reason === "output_limit") outputLimitExceeded = true;
      terminateProcessGroup(child, "SIGTERM");
      killTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), terminationGraceMs);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const result = appendLimited(stdout, chunk, maxOutputBytes, capturedOutputBytes);
      capturedOutputBytes += result.bytes;
      if (result.exceeded) stop("output_limit");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const result = appendLimited(stderr, chunk, maxOutputBytes, capturedOutputBytes);
      capturedOutputBytes += result.bytes;
      if (result.exceeded) stop("output_limit");
    });
    child.once("error", () => {
      spawnError = true;
      if (!failure) failure = "spawn";
    });
    const timeout = setTimeout(() => stop("timeout"), input.timeoutMs);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: spawnError ? null : exitCode,
        signal,
        timedOut,
        outputLimitExceeded,
        failure: spawnError ? "spawn" : failure,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
