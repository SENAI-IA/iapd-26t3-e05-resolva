import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureArtifact } from "./artifacts.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "resolva-artifact-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "logs"));
  return root;
}

describe("captura de artefatos", () => {
  it("redige segredos antes de calcular o hash", async () => {
    const root = project();
    writeFileSync(join(root, "logs", "run.log"), "resultado token-ficticio concluído\n");

    const artifact = await captureArtifact({
      root,
      relativePath: "logs/run.log",
      kind: "log",
      contentType: "text/plain",
      secretValues: ["token-ficticio"],
    });

    expect(artifact.content).toBe("resultado [REDACTED] concluído\n");
    expect(artifact.content).not.toContain("token-ficticio");
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.sizeBytes).toBe(Buffer.byteLength(artifact.content));
  });

  it("recusa caminho externo e arquivo acima do limite", async () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), "resolva-artifact-outside-"));
    temporaryDirectories.push(outside);
    writeFileSync(join(outside, "secret.log"), "segredo");
    symlinkSync(join(outside, "secret.log"), join(root, "logs", "external.log"));

    await expect(
      captureArtifact({
        root,
        relativePath: "logs/external.log",
        kind: "log",
        contentType: "text/plain",
      }),
    ).rejects.toThrow("Artefato fora da raiz autorizada.");
    writeFileSync(join(root, "logs", "large.log"), "x".repeat(1025));
    await expect(
      captureArtifact({
        root,
        relativePath: "logs/large.log",
        kind: "log",
        contentType: "text/plain",
        maxBytes: 1024,
      }),
    ).rejects.toThrow("Artefato excede os limites permitidos.");
  });
});
