import type { ImplementationEvidence } from "../domain/implementationEvidence.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
type ReportDescriptor = ImplementationEvidence["report"];
const descriptorSchema = z.strictObject({
  relativePath: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024),
});
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
export function createReportStore(root: string) {
  const path = resolve(root);
  const writes = new Map<string, Promise<ReportDescriptor>>();
  const identity = (value: string) => z.uuid().parse(value).toLowerCase();
  async function directory(executionId: string, create: boolean) {
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    const anchor = await realpath(path);
    const target = join(anchor, executionId);
    if (create) {
      try {
        await mkdir(target, { mode: 0o700 });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
    const stat = await lstat(target);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o022) !== 0 ||
      (await realpath(target)) !== target
    )
      throw new Error();
    return target;
  }
  function filename(executionId: string, descriptor: ReportDescriptor) {
    const expected = `${executionId}/validation-${descriptor.sha256}.json`;
    if (descriptor.relativePath !== expected) throw new Error();
    return `validation-${descriptor.sha256}.json`;
  }
  async function read(executionId: string, descriptor: ReportDescriptor, target?: string) {
    const dir = target ?? (await directory(executionId, false));
    const file = await open(
      join(dir, filename(executionId, descriptor)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== descriptor.sizeBytes)
        throw new Error();
      const chunks: Buffer[] = [];
      for await (const chunk of file.createReadStream({ end: 64 * 1024, autoClose: false }))
        chunks.push(chunk);
      const content = Buffer.concat(chunks);
      if (
        content.length !== descriptor.sizeBytes ||
        createHash("sha256").update(content).digest("hex") !== descriptor.sha256
      )
        throw new Error();
      return content;
    } finally {
      await file.close();
    }
  }
  async function persist(executionId: string, bytes: Buffer, descriptor: ReportDescriptor) {
    const dir = await directory(executionId, true);
    try {
      await read(executionId, descriptor, dir);
      return descriptor;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const temporary = join(dir, `.pending-${randomUUID()}`);
    try {
      const file = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, join(dir, filename(executionId, descriptor)));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    await read(executionId, descriptor, dir);
    const parent = await open(
      dir,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return descriptor;
  }
  return {
    async persist(executionId: string, content: Buffer): Promise<ReportDescriptor> {
      try {
        const id = identity(executionId);
        if (content.length < 1 || content.length > 64 * 1024) throw new Error();
        const bytes = Buffer.from(content);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const descriptor = {
          relativePath: `${id}/validation-${sha256}.json`,
          sha256,
          sizeBytes: bytes.length,
        };
        const existing = writes.get(descriptor.relativePath);
        if (existing) return await existing;
        const operation = persist(id, bytes, descriptor);
        writes.set(descriptor.relativePath, operation);
        try {
          return await operation;
        } finally {
          writes.delete(descriptor.relativePath);
        }
      } catch {
        throw new Error("Não foi possível salvar o relatório de validação.");
      }
    },
    async read(executionId: string, descriptor: ReportDescriptor): Promise<Buffer> {
      try {
        return await read(identity(executionId), descriptorSchema.parse(descriptor));
      } catch {
        throw new Error("O relatório de validação está indisponível.");
      }
    },
  };
}
export type ReportStore = ReturnType<typeof createReportStore>;
