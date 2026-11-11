import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createReportStore } from "./reportStore.js";

const roots: string[] = [];
const executionId = "11111111-1111-4111-8111-111111111111";
async function root() {
  const path = await mkdtemp(join(tmpdir(), "resolva-report-store-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("armazenamento privado de relatório", () => {
  it("persiste cópia íntegra identificada por conteúdo e a reutiliza", async () => {
    const path = await root();
    const store = createReportStore(path);
    const content = Buffer.from('{"status":"passed"}');
    const report = await store.persist(executionId, content);
    expect(report.relativePath).toMatch(
      new RegExp(`^${executionId}/validation-[a-f0-9]{64}\\.json$`, "u"),
    );
    expect(await store.read(executionId, report)).toEqual(content);
    await expect(store.persist(executionId, content)).resolves.toEqual(report);
    expect(await readdir(join(path, executionId))).toEqual([report.relativePath.split("/")[1]]);
  });

  it("serializa cópias concorrentes do mesmo conteúdo sem arquivo parcial", async () => {
    const path = await root();
    const store = createReportStore(path);
    const content = Buffer.from('{"status":"passed"}');
    const [first, second] = await Promise.all([
      store.persist(executionId, content),
      store.persist(executionId, content),
    ]);
    expect(first).toEqual(second);
    expect(await readFile(join(path, first.relativePath))).toEqual(content);
  });

  it("recusa symlink no diretório da execução e não escreve fora da raiz", async () => {
    const path = await root();
    const outside = await root();
    await symlink(outside, join(path, executionId));
    await expect(createReportStore(path).persist(executionId, Buffer.from("{}"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });

  it("recusa arquivo alterado e symlink no lugar de relatório aprovado", async () => {
    const path = await root();
    const store = createReportStore(path);
    const report = await store.persist(executionId, Buffer.from("{}"));
    await writeFile(join(path, report.relativePath), "alterado");
    await expect(store.read(executionId, report)).rejects.toThrow();
    await rm(join(path, report.relativePath));
    const outside = await root();
    await writeFile(join(outside, "secret.json"), "{}");
    await symlink(join(outside, "secret.json"), join(path, report.relativePath));
    await expect(store.read(executionId, report)).rejects.toThrow();
  });

  it("recusa identidade, tamanho e descriptor fora do caminho reservado", async () => {
    const path = await root();
    const store = createReportStore(path);
    await expect(store.persist("../outra", Buffer.from("{}"))).rejects.toThrow();
    await expect(store.persist(executionId, Buffer.alloc(64 * 1024 + 1))).rejects.toThrow();
    const report = await store.persist(executionId, Buffer.from("{}"));
    await expect(
      store.read(executionId, { ...report, relativePath: "../secret.json" }),
    ).rejects.toThrow();
  });

  it("não cria arquivo final se o caminho reservado já contém conteúdo divergente", async () => {
    const path = await root();
    const store = createReportStore(path);
    const report = await store.persist(executionId, Buffer.from("{}"));
    await writeFile(join(path, report.relativePath), "outro conteúdo");
    await expect(store.persist(executionId, Buffer.from("{}"))).rejects.toThrow();
    expect((await readFile(join(path, report.relativePath))).toString()).toBe("outro conteúdo");
  });
});
