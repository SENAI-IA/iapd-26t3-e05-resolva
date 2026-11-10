import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ConfigurationError } from "./error.js";
import { hasControlCharacters } from "./strings.js";
import { defaultCategories } from "../domain/contracts.js";

const relativePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !hasControlCharacters(value) &&
      !["\\", ":", "*", "?", "[", "]", "{", "}"].some((character) => value.includes(character)) &&
      value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  );

function isWritablePath(value: string) {
  if (value === "") return false;
  return value
    .split(/[\\/]/u)
    .every(
      (part) =>
        ![
          ".git",
          ".github",
          ".kiro",
          ".codex",
          ".agents",
          ".aws",
          ".resolva",
          "node_modules",
        ].includes(part.toLowerCase()) &&
        part.toLowerCase() !== ".env" &&
        !part.toLowerCase().startsWith(".env."),
    );
}

const writablePath = relativePath.refine(isWritablePath);
const commandSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
  executable: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/u)
    .refine(
      (value) =>
        ![
          "sh",
          "bash",
          "zsh",
          "fish",
          "dash",
          "cmd",
          "cmd.exe",
          "powershell",
          "pwsh",
          "env",
          "sudo",
          "doas",
        ].includes(value.toLowerCase()),
    ),
  args: z
    .array(
      z
        .string()
        .max(4096)
        .refine((value) => !hasControlCharacters(value)),
    )
    .max(100),
  cwd: z.union([z.literal("."), relativePath]),
});
export const configuredCommandSchema = commandSchema.extend({ kind: z.enum(["check", "test"]) });
export type ConfiguredCommand = z.infer<typeof configuredCommandSchema>;

const categorySchema = z.strictObject({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  label: z.string().trim().min(1).max(100),
});

function validBranch(value: string) {
  return (
    value !== "@" &&
    value !== "HEAD" &&
    !value.startsWith("-") &&
    !hasControlCharacters(value) &&
    ![" ", "~", "^", ":", "?", "*", "[", "\\"].some((character) => value.includes(character)) &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    value
      .split("/")
      .every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}

export const targetSystemKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);

const targetSystemDisplayNameSchema = z.string().trim().min(1).max(100);
const targetSystemVersionSchema = z.number().int().positive().max(2147483647);

function containsPath(root: string, path: string) {
  const difference = relative(root, path);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

export const projectConfigSchema = z
  .strictObject({
    targetSystemKey: targetSystemKeySchema,
    displayName: targetSystemDisplayNameSchema,
    version: targetSystemVersionSchema.default(1),
    workflowRef: z.string().min(1).max(255).refine(validBranch),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u)
      .refine((value) => !value.endsWith(".git") && !value.includes("..")),
    baseBranch: z.string().min(1).max(255).refine(validBranch),
    repositoryRoot: relativePath,
    allowedPaths: z.array(writablePath).min(1).max(100),
    testPaths: z.array(writablePath).min(1).max(100),
    documentationPaths: z.array(relativePath).min(1).max(100),
    categories: z.array(categorySchema).min(1).max(100).default(defaultCategories),
    preparationCommands: z.array(commandSchema).max(20),
    validationCommands: z.array(configuredCommandSchema).min(1).max(20),
    regressionCommand: commandSchema.extend({ kind: z.literal("test") }),
    testAdapter: z.literal("vitest-json"),
    kiroModel: z.string().trim().min(1).max(200),
    maxRounds: z.number().int().min(1).max(3).default(3),
    runTimeoutSeconds: z.number().int().min(60).max(3600).default(1800),
    commandTimeoutSeconds: z.number().int().min(1).max(3600).default(300),
    kiroTimeoutSeconds: z.number().int().min(1).max(3600).default(300),
    maxChangedFiles: z.number().int().min(1).max(1000).default(20),
    maxChangedLines: z.number().int().min(1).max(100000).default(1000),
    workspaceRoot: relativePath.default(".resolva/workspaces"),
    artifactRoot: relativePath.default(".resolva/artifacts"),
  })
  .superRefine((config, context) => {
    const reject = () =>
      context.addIssue({ code: "custom", message: "Configuração inconsistente." });
    if (
      config.testPaths.some(
        (path) =>
          !config.allowedPaths.some((allowed) => containsPath(resolve(allowed), resolve(path))),
      )
    )
      reject();
    if (
      new Set(config.categories.map((category) => category.slug)).size !== config.categories.length
    )
      reject();
    const commands = [
      ...config.preparationCommands,
      ...config.validationCommands,
      config.regressionCommand,
    ];
    if (new Set(commands.map((command) => command.id)).size !== commands.length) reject();
    const tests = config.validationCommands.filter((command) => command.kind === "test");
    if (
      tests.length === 0 ||
      [...tests, config.regressionCommand].some(
        (command) => !command.args.some((arg) => arg.includes("{reportPath}")),
      )
    )
      reject();
  });

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type TargetSystemConfig = ProjectConfig;
export type TargetSystemConfigSnapshot = ProjectConfig & { snapshotHash: string };

export function parseProjectConfig(value: unknown): ProjectConfig {
  const result = projectConfigSchema.safeParse(value);
  if (!result.success) throw new ConfigurationError("Configuração do projeto inválida.");
  return result.data;
}

export function createTargetSystemSnapshot(config: TargetSystemConfig): TargetSystemConfigSnapshot {
  const snapshotHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  return { ...config, snapshotHash };
}

function resolvedPath(path: string): string {
  try {
    lstatSync(path);
    return realpathSync(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    // Um link quebrado existe para lstat, mas realpath falha: não o trate como diretório novo.
    try {
      if (lstatSync(path).isSymbolicLink()) throw new ConfigurationError("Caminho inválido.");
    } catch (statError) {
      if (!(statError instanceof Error) || !("code" in statError) || statError.code !== "ENOENT")
        throw statError;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(resolvedPath(parent), relative(parent, path));
  }
}

function assertDirectoryIfPresent(path: string) {
  try {
    if (!statSync(path).isDirectory()) throw new Error();
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

export function loadProjectConfig(path: string): ProjectConfig {
  try {
    const config = parseProjectConfig(JSON.parse(readFileSync(path, "utf8")));
    const root = realpathSync(dirname(resolve(path)));
    const target = resolvedPath(resolve(root, config.repositoryRoot));
    if (!containsPath(root, target) || !statSync(target).isDirectory()) throw new Error();
    for (const entry of [
      ...config.allowedPaths,
      ...config.testPaths,
      ...config.documentationPaths,
      ...config.preparationCommands.map((command) => command.cwd),
      ...config.validationCommands.map((command) => command.cwd),
      config.regressionCommand.cwd,
    ]) {
      const resolved = resolvedPath(resolve(target, entry));
      if (!containsPath(target, resolved)) throw new Error();
      assertDirectoryIfPresent(resolved);
    }
    for (const entry of [...config.allowedPaths, ...config.testPaths]) {
      if (!isWritablePath(relative(target, resolvedPath(resolve(target, entry)))))
        throw new Error();
    }
    const allowed = config.allowedPaths.map((entry) => resolvedPath(resolve(target, entry)));
    for (const entry of config.testPaths) {
      const test = resolvedPath(resolve(target, entry));
      if (!allowed.some((directory) => containsPath(directory, test))) throw new Error();
    }
    const workspace = resolvedPath(resolve(root, config.workspaceRoot));
    const artifacts = resolvedPath(resolve(root, config.artifactRoot));
    assertDirectoryIfPresent(workspace);
    assertDirectoryIfPresent(artifacts);
    if (
      ![workspace, artifacts].every(
        (runtime) =>
          containsPath(root, runtime) &&
          !containsPath(target, runtime) &&
          !containsPath(runtime, target),
      ) ||
      containsPath(workspace, artifacts) ||
      containsPath(artifacts, workspace)
    )
      throw new Error();
    return config;
  } catch {
    throw new ConfigurationError("Não foi possível carregar a configuração do projeto.");
  }
}
