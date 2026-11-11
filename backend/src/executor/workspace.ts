import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { runCommand } from "./process.js";

const pathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const shaPattern = /^[a-f0-9]{40}$/u;

export interface WorkspaceInput {
  sourceRoot: string;
  workspaceRoot: string;
  executionId: string;
}

export interface Workspace {
  path: string;
  sourceRoot: string;
  baseSha: string;
}

export interface ChangePolicy {
  phase: "regression" | "fix";
  allowedPaths: readonly string[];
  testPaths: readonly string[];
  maxChangedFiles: number;
  maxChangedLines: number;
  allowTestChanges?: boolean;
}

export interface DiffSummary {
  paths: readonly string[];
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  sha256: string;
}

interface LineChange {
  added: number;
  deleted: number;
}

function isWithin(root: string, candidate: string) {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

function assertPathSegment(value: string) {
  if (!pathSegmentPattern.test(value)) throw new Error("Identificador de workspace inválido.");
}

function isIgnoredDirectory(name: string) {
  return name === "node_modules" || name === ".resolva";
}

async function assertSafeSourceTree(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && isIgnoredDirectory(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(path);
      if (!isWithin(root, target))
        throw new Error("A cópia contém um symlink fora do sistema-alvo.");
      continue;
    }
    if (entry.isDirectory()) await assertSafeSourceTree(root, path);
  }
}

async function git(cwd: string, args: readonly string[], maxOutputBytes = 10 * 1024 * 1024) {
  const result = await runCommand({
    executable: "git",
    args,
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes,
  });
  if (result.failure || result.exitCode !== 0)
    throw new Error("Não foi possível consultar o estado Git do workspace.");
  return result.stdout;
}

export async function createWorkspace(input: WorkspaceInput): Promise<Workspace> {
  assertPathSegment(input.executionId);
  if (!input.sourceRoot || !input.workspaceRoot) throw new Error("Raiz de workspace inválida.");
  const sourceRoot = await realpath(input.sourceRoot);
  const workspaceRoot = resolve(input.workspaceRoot);
  await stat(sourceRoot).then((value) => {
    if (!value.isDirectory()) throw new Error("A raiz do sistema-alvo não é um diretório.");
  });
  await assertSafeSourceTree(sourceRoot);
  await mkdir(workspaceRoot, { recursive: true });
  const resolvedWorkspaceRoot = await realpath(workspaceRoot);
  if (isWithin(sourceRoot, resolvedWorkspaceRoot) || isWithin(resolvedWorkspaceRoot, sourceRoot))
    throw new Error("A raiz do workspace não pode sobrepor o sistema-alvo.");

  const path = resolve(resolvedWorkspaceRoot, input.executionId);
  try {
    await stat(path);
    throw new Error("O workspace da execução já existe.");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    await cp(sourceRoot, path, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      filter: (entry) => {
        const name = entry.split(sep).at(-1) ?? "";
        return !isIgnoredDirectory(name);
      },
    });
    const baseSha = (await git(path, ["rev-parse", "--verify", "HEAD"], 1024)).trim();
    if (!shaPattern.test(baseSha)) throw new Error("SHA inicial do workspace inválido.");
    return { path, sourceRoot, baseSha };
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

function parseStatus(raw: string) {
  const paths: string[] = [];
  const records = raw.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const path = record.slice(3);
    if (!path) continue;
    paths.push(path);
    const status = record.slice(0, 2);
    if (status.startsWith("R") || status.startsWith("C")) {
      const renamedPath = records[index + 1];
      if (renamedPath) paths.push(renamedPath);
      index += 1;
    }
  }
  return paths;
}

function parseNumstat(raw: string) {
  const changes = new Map<string, LineChange>();
  for (const record of raw.split("\0")) {
    if (!record) continue;
    const fields = record.split("\t");
    if (fields.length < 3) continue;
    const [added, deleted, ...pathParts] = fields;
    const path = pathParts.join("\t");
    if (!path) continue;
    changes.set(path, {
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted),
    });
  }
  return changes;
}

function lineCount(content: string) {
  if (!content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function validRelativePath(path: string) {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    ![...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function sensitivePath(path: string) {
  return path.split("/").some((part) => {
    const normalized = part.toLowerCase();
    return (
      [
        ".git",
        ".github",
        ".kiro",
        ".codex",
        ".agents",
        ".aws",
        ".resolva",
        "node_modules",
      ].includes(normalized) ||
      normalized === ".env" ||
      normalized.startsWith(".env.")
    );
  });
}

function underAny(path: string, roots: readonly string[]) {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function assertPolicyPath(path: string, policy: ChangePolicy) {
  if (!validRelativePath(path) || sensitivePath(path) || !underAny(path, policy.allowedPaths))
    throw new Error("Arquivo alterado fora dos caminhos permitidos.");
  if (policy.phase === "fix" && !policy.allowTestChanges && underAny(path, policy.testPaths))
    throw new Error("Caminho de teste alterado fora da fase de regressão.");
}

export async function collectValidatedDiff(
  workspace: Workspace,
  policy: ChangePolicy,
): Promise<DiffSummary> {
  if (!shaPattern.test(workspace.baseSha)) throw new Error("SHA inicial do workspace inválido.");
  if (!Number.isInteger(policy.maxChangedFiles) || policy.maxChangedFiles < 1)
    throw new Error("Limite de arquivos alterados inválido.");
  if (!Number.isInteger(policy.maxChangedLines) || policy.maxChangedLines < 1)
    throw new Error("Limite de linhas alteradas inválido.");

  const [statusOutput, numstatOutput, rawOutput] = await Promise.all([
    git(workspace.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"]),
    git(workspace.path, ["diff", "--numstat", "--find-renames", "-z", workspace.baseSha, "--"]),
    git(workspace.path, ["diff", "--raw", "--find-renames", "-z", workspace.baseSha, "--"]),
  ]);
  const paths = [
    ...new Set([...parseStatus(statusOutput), ...parseNumstat(numstatOutput).keys()]),
  ].sort();
  if (paths.length > policy.maxChangedFiles)
    throw new Error("Limite de arquivos alterados excedido.");
  for (const path of paths) assertPolicyPath(path, policy);

  const changes = parseNumstat(numstatOutput);
  for (const path of paths) {
    if (changes.has(path) || !statusOutput.includes(path)) continue;
    const content = await readFile(resolve(workspace.path, path), "utf8").catch(() => "");
    changes.set(path, { added: lineCount(content), deleted: 0 });
  }
  const addedLines = [...changes.values()].reduce((sum, change) => sum + change.added, 0);
  const deletedLines = [...changes.values()].reduce((sum, change) => sum + change.deleted, 0);
  if (addedLines + deletedLines > policy.maxChangedLines)
    throw new Error("Limite de linhas alteradas excedido.");
  const sha256 = createHash("sha256")
    .update(rawOutput)
    .update(
      JSON.stringify([...changes.entries()].sort(([left], [right]) => left.localeCompare(right))),
    )
    .digest("hex");
  return {
    paths,
    changedFiles: paths.length,
    addedLines,
    deletedLines,
    sha256,
  };
}
