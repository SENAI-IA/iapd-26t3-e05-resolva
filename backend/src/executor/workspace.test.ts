import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "./process.js";
import { collectValidatedDiff, createWorkspace, type ChangePolicy } from "./workspace.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function command(cwd: string, args: string[]) {
  const result = await runCommand({
    executable: "git",
    args,
    cwd,
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
    env: {
      GIT_AUTHOR_NAME: "Teste",
      GIT_AUTHOR_EMAIL: "teste@example.invalid",
      GIT_COMMITTER_NAME: "Teste",
      GIT_COMMITTER_EMAIL: "teste@example.invalid",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function runtimeRoot() {
  const directory = mkdtempSync(join(tmpdir(), "resolva-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function repository() {
  const root = mkdtempSync(join(tmpdir(), "resolva-workspace-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "src", "total.ts"), "export const total = 1;\n");
  writeFileSync(join(root, "tests", "total.test.ts"), "export {};\n");
  await command(root, ["init", "--initial-branch", "main"]);
  await command(root, ["add", "."]);
  await command(root, ["commit", "-m", "base"]);
  return root;
}

function policy(overrides: Partial<ChangePolicy> = {}): ChangePolicy {
  return {
    phase: "fix",
    allowedPaths: ["src", "tests"],
    testPaths: ["tests"],
    maxChangedFiles: 10,
    maxChangedLines: 20,
    ...overrides,
  };
}

describe("workspace do executor", () => {
  it("cria uma cópia isolada e preserva o SHA de origem", async () => {
    const sourceRoot = await repository();
    const runtime = runtimeRoot();
    const workspace = await createWorkspace({
      sourceRoot,
      workspaceRoot: runtime,
      executionId: "exec-1",
    });

    expect(workspace.baseSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(workspace.path).toBe(join(runtime, "exec-1"));
    expect(workspace.sourceRoot).toBe(sourceRoot);
    expect(workspace.path).not.toBe(sourceRoot);
  });

  it("aceita alteração em caminho permitido e calcula linhas e hash", async () => {
    const sourceRoot = await repository();
    const workspace = await createWorkspace({
      sourceRoot,
      workspaceRoot: runtimeRoot(),
      executionId: "exec-2",
    });
    writeFileSync(join(workspace.path, "src", "total.ts"), "export const total = 2;\nexport {};\n");

    const diff = await collectValidatedDiff(workspace, policy());

    expect(diff).toMatchObject({
      paths: ["src/total.ts"],
      changedFiles: 1,
      addedLines: 2,
      deletedLines: 1,
    });
    expect(diff.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("inclui arquivo novo e recusa alteração em teste durante o fix", async () => {
    const sourceRoot = await repository();
    const workspace = await createWorkspace({
      sourceRoot,
      workspaceRoot: runtimeRoot(),
      executionId: "exec-3",
    });
    writeFileSync(join(workspace.path, "src", "new.ts"), "export const value = 1;\n");
    const diff = await collectValidatedDiff(workspace, policy());
    expect(diff.paths).toEqual(["src/new.ts"]);

    writeFileSync(join(workspace.path, "tests", "total.test.ts"), "export const changed = true;\n");
    await expect(collectValidatedDiff(workspace, policy())).rejects.toThrow(
      "Caminho de teste alterado fora da fase de regressão.",
    );
  });

  it("recusa caminho fora da política e excedente de linhas", async () => {
    const sourceRoot = await repository();
    const workspace = await createWorkspace({
      sourceRoot,
      workspaceRoot: runtimeRoot(),
      executionId: "exec-4",
    });
    writeFileSync(join(workspace.path, "README.md"), "fora\n");
    await expect(collectValidatedDiff(workspace, policy())).rejects.toThrow(
      "Arquivo alterado fora dos caminhos permitidos.",
    );

    rmSync(join(workspace.path, "README.md"));
    writeFileSync(join(workspace.path, "src", "total.ts"), `${"linha\n".repeat(30)}`);
    await expect(collectValidatedDiff(workspace, policy({ maxChangedLines: 2 }))).rejects.toThrow(
      "Limite de linhas alteradas excedido.",
    );
  });
});
