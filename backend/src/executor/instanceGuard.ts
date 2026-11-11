import { randomUUID } from "node:crypto";
import { open, readFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import type { AppDatabase } from "../db/index.js";

const lockFileName = ".instance.lock";

export class InstanceGuardError extends Error {
  constructor(message = "A instância já está sendo executada por outro processo.") {
    super(message);
    this.name = "InstanceGuardError";
  }
}

export interface InstanceGuard {
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

function lockContent(owner: string) {
  return `${process.pid}:${owner}`;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function acquireLocalLock(path: string, owner: string) {
  const content = lockContent(owner);
  for (;;) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.close();
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      let existing: string;
      try {
        existing = await readFile(path, "utf8");
      } catch (readError) {
        if (readError instanceof Error && "code" in readError && readError.code === "ENOENT")
          continue;
        throw readError;
      }
      const pid = Number(existing.split(":", 1)[0]);
      if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
        await rm(path, { force: true });
        continue;
      }
      throw new InstanceGuardError();
    }
  }
}

async function ownsLocalLock(path: string, owner: string) {
  try {
    return (await readFile(path, "utf8")) === lockContent(owner);
  } catch {
    return false;
  }
}

export async function createInstanceGuard(
  database: AppDatabase,
  runtimeRoot: string,
): Promise<InstanceGuard> {
  const root = resolve(runtimeRoot);
  await mkdir(root, { recursive: true });
  const lockPath = resolve(root, lockFileName);
  const owner = randomUUID();
  await acquireLocalLock(lockPath, owner);
  let client: PoolClient | undefined;
  try {
    client = await database.pool.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [root],
    );
    if (!result.rows[0]?.acquired) throw new InstanceGuardError();
  } catch (error) {
    client?.release();
    await rm(lockPath, { force: true });
    if (error instanceof InstanceGuardError) throw error;
    throw new InstanceGuardError("Não foi possível reservar o lock da instância.");
  }

  let released = false;
  return {
    async assertOwned() {
      if (released || !client || !(await ownsLocalLock(lockPath, owner)))
        throw new InstanceGuardError("A posse do lock da instância foi perdida.");
      try {
        await client.query("SELECT 1");
      } catch {
        throw new InstanceGuardError("A conexão do lock da instância foi perdida.");
      }
    },
    async release() {
      if (released) return;
      released = true;
      let failure: unknown;
      try {
        await client?.query("SELECT pg_advisory_unlock(hashtext($1))", [root]);
      } catch (error) {
        failure = error;
      } finally {
        client?.release();
        if (await ownsLocalLock(lockPath, owner)) await rm(lockPath, { force: true });
      }
      if (failure) throw new InstanceGuardError("Não foi possível liberar o lock da instância.");
    },
  };
}
