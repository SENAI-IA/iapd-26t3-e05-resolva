import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TargetSystemConfig } from "../../config/project.js";
import { runCommand } from "../../executor/process.js";
import type { TriageRunner } from "../../services/triageService.js";
import { runKiroTriage } from "./client.js";

const maximumSourceFiles = 100;
const maximumSourceFileBytes = 128 * 1024;
const maximumSourceBytes = 512 * 1024;
const ignoredDirectories = new Set([".git", ".kiro", ".resolva", "node_modules"]);

function isInside(root: string, path: string) {
  const difference = relative(root, path);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

export async function collectAuthorizedSources(root: string, config: TargetSystemConfig) {
  const files: string[] = [];
  const roots = [...new Set([...config.documentationPaths, ...config.allowedPaths])].sort();

  async function visit(path: string) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return;
    if (entry.isDirectory()) {
      const names = (await readdir(path)).sort();
      for (const name of names) {
        if (ignoredDirectories.has(name) || name.startsWith(".")) continue;
        await visit(resolve(path, name));
      }
      return;
    }
    if (entry.isFile() && entry.size <= maximumSourceFileBytes && files.length < maximumSourceFiles)
      files.push(path);
  }

  for (const sourceRoot of roots) {
    const path = resolve(root, sourceRoot);
    if (isInside(root, path)) await visit(path);
  }

  let totalBytes = 0;
  const sources: { path: string; text: string }[] = [];
  for (const path of files) {
    const content = await readFile(path);
    if (content.includes(0)) continue;
    if (totalBytes + content.byteLength > maximumSourceBytes) break;
    totalBytes += content.byteLength;
    sources.push({
      path: relative(root, path).split(sep).join("/"),
      text: content.toString("utf8"),
    });
  }
  return sources;
}

export function createKiroTriageRunner(input: {
  applicationRoot: string;
  executable: string;
  model: string;
  apiKey: string;
  secretValues?: readonly string[];
  timeoutSeconds: number;
}): TriageRunner {
  return async (reservation) => {
    const config = reservation.ticket.targetConfigSnapshot as TargetSystemConfig;
    const repositoryRoot = resolve(input.applicationRoot, config.repositoryRoot);
    const sources = await collectAuthorizedSources(repositoryRoot, config);
    return runKiroTriage(
      {
        executionId: reservation.executionId,
        ticket: reservation.ticket,
        sources,
        executable: input.executable,
        model: input.model,
        apiKey: input.apiKey,
        ...(input.secretValues === undefined ? {} : { secretValues: input.secretValues }),
        timeoutSeconds: input.timeoutSeconds,
      },
      async (command) => {
        const result = await runCommand({
          executable: command.executable,
          args: command.args,
          cwd: command.cwd,
          env: command.env,
          stdin: command.stdin,
          timeoutMs: command.timeoutMs,
          maxOutputBytes: command.maxOutputBytes,
        });
        return { exitCode: result.exitCode };
      },
    );
  };
}
