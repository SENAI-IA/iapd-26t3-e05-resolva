import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManifest, verifyManifest } from "./manifest.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "resolva-manifest-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "total.ts"), "export const total = 1;\n");
  return root;
}

describe("manifesto de fontes e testes", () => {
  it("calcula hashes e detecta alteração posterior", async () => {
    const root = project();
    const manifest = await createManifest(root, ["src/total.ts"]);

    expect(manifest).toEqual([
      {
        path: "src/total.ts",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sizeBytes: 24,
        lineCount: 1,
      },
    ]);
    await expect(verifyManifest(root, manifest)).resolves.toBe(true);
    writeFileSync(join(root, "src", "total.ts"), "export const total = 2;\n");
    await expect(verifyManifest(root, manifest)).resolves.toBe(false);
  });

  it("recusa caminhos externos, symlinks e duplicidades", async () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), "resolva-manifest-outside-"));
    temporaryDirectories.push(outside);
    writeFileSync(join(outside, "secret.txt"), "segredo");
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "link.txt"));

    await expect(createManifest(root, ["../segredo"])).rejects.toThrow(
      "Caminho de manifesto inválido.",
    );
    await expect(createManifest(root, ["src/link.txt"])).rejects.toThrow(
      "Fonte fora da raiz do workspace.",
    );
    await expect(createManifest(root, ["src/total.ts", "src/total.ts"])).rejects.toThrow(
      "caminhos repetidos",
    );
  });
});
