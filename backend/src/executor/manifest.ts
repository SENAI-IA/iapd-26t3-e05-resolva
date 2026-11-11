import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const maxManifestEntries = 1000;
const maxFileBytes = 4 * 1024 * 1024;

export interface ManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
  lineCount: number;
}

function isWithin(root: string, candidate: string) {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

function validPath(path: string) {
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

function countLines(content: string) {
  if (!content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

async function readManifestEntry(root: string, path: string): Promise<ManifestEntry> {
  if (!validPath(path)) throw new Error("Caminho de manifesto inválido.");
  const absoluteRoot = await realpath(root);
  const absolutePath = resolve(absoluteRoot, path);
  const target = await realpath(absolutePath);
  if (!isWithin(absoluteRoot, target)) throw new Error("Fonte fora da raiz do workspace.");
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > maxFileBytes)
    throw new Error("Arquivo de manifesto inválido.");
  const content = await readFile(target);
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
    lineCount: countLines(content.toString("utf8")),
  };
}

export async function createManifest(
  root: string,
  paths: readonly string[],
): Promise<readonly ManifestEntry[]> {
  if (paths.length > maxManifestEntries)
    throw new Error("O manifesto excede o limite de arquivos.");
  if (new Set(paths).size !== paths.length)
    throw new Error("O manifesto contém caminhos repetidos.");
  const entries = await Promise.all(paths.map((path) => readManifestEntry(root, path)));
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function verifyManifest(
  root: string,
  manifest: readonly ManifestEntry[],
): Promise<boolean> {
  try {
    const current = await createManifest(
      root,
      manifest.map((entry) => entry.path),
    );
    return (
      JSON.stringify(current) ===
      JSON.stringify([...manifest].sort((left, right) => left.path.localeCompare(right.path)))
    );
  } catch {
    return false;
  }
}
