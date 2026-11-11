import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const defaultMaxBytes = 1024 * 1024;

export interface ArtifactCaptureInput {
  root: string;
  relativePath: string;
  kind: string;
  contentType: string;
  secretValues?: readonly string[];
  maxBytes?: number;
}

export interface CapturedArtifact {
  kind: string;
  relativePath: string;
  contentType: string;
  content: string;
  sizeBytes: number;
  sha256: string;
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

function redact(value: string, secrets: readonly string[]) {
  return [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
}

export async function captureArtifact(input: ArtifactCaptureInput): Promise<CapturedArtifact> {
  if (!validRelativePath(input.relativePath)) throw new Error("Caminho de artefato inválido.");
  if (!input.kind || !input.contentType) throw new Error("Metadados de artefato inválidos.");
  const maxBytes = input.maxBytes ?? defaultMaxBytes;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > defaultMaxBytes)
    throw new Error("Limite de artefato inválido.");

  const root = await realpath(input.root);
  const path = resolve(root, input.relativePath);
  const target = await realpath(path);
  const difference = relative(root, target);
  if (
    difference !== "" &&
    (isAbsolute(difference) || difference === ".." || difference.startsWith(`..${sep}`))
  )
    throw new Error("Artefato fora da raiz autorizada.");
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > maxBytes)
    throw new Error("Artefato excede os limites permitidos.");
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: Buffer;
  try {
    const content = await readFile(file);
    if (content.byteLength > maxBytes) throw new Error("Artefato excede os limites permitidos.");
    raw = content;
  } finally {
    await file.close();
  }
  const content = redact(raw.toString("utf8"), input.secretValues ?? []);
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    kind: input.kind,
    relativePath: input.relativePath,
    contentType: input.contentType,
    content,
    sizeBytes: bytes,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}
