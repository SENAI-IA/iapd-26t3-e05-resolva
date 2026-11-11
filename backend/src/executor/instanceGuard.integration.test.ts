import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInstanceGuard, InstanceGuardError } from "./instanceGuard.js";
import { recoverInterruptedExecutions } from "./recovery.js";
import { startTestDatabase } from "../test/database.js";

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  resource = await startTestDatabase();
});
afterAll(async () => {
  await resource?.stop();
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});

function runtimeRoot() {
  const path = mkdtempSync(join(tmpdir(), "resolva-guard-"));
  temporaryDirectories.push(path);
  return path;
}

async function activeExecution() {
  const ticket = await resource.database.pool.query<{ id: number }>(
    `INSERT INTO tickets (target_system_key, target_config_version, target_config_snapshot, title, description, expected_behavior, category, status)
     VALUES ('demo', 1, '{}', 'Quantidade incorreta', 'Descrição suficiente para um ticket', 'Total conforme a quantidade', 'calculo', 'em_triagem')
     RETURNING id`,
  );
  const ticketId = ticket.rows[0]?.id;
  if (!ticketId) throw new Error("Ticket não criado.");
  const execution = await resource.database.pool.query<{ id: string }>(
    `INSERT INTO executions (ticket_id, ticket_version, kind, request_key, status, stage, ticket_snapshot)
     VALUES ($1, 1, 'triage', $2, 'em_andamento', 'analisando_ticket', '{}') RETURNING id`,
    [ticketId, randomUUID()],
  );
  const executionId = execution.rows[0]?.id;
  if (!executionId) throw new Error("Execução não criada.");
  await resource.database.pool.query(
    "INSERT INTO execution_events (execution_id, sequence, type, stage, message) VALUES ($1, 1, 'started', 'analisando_ticket', 'Início')",
    [executionId],
  );
  return { ticketId, executionId };
}

describe("lock da instância e recuperação", () => {
  it("impede dois donos e libera o lock após a saída", async () => {
    const root = runtimeRoot();
    const first = await createInstanceGuard(resource.database, root);
    await expect(createInstanceGuard(resource.database, root)).rejects.toBeInstanceOf(
      InstanceGuardError,
    );
    await first.release();
    const second = await createInstanceGuard(resource.database, root);
    await expect(second.assertOwned()).resolves.toBeUndefined();
    await second.release();
  });

  it("recusa uso depois da liberação", async () => {
    const guard = await createInstanceGuard(resource.database, runtimeRoot());
    await guard.release();
    await expect(guard.assertOwned()).rejects.toBeInstanceOf(InstanceGuardError);
  });

  it("interrompe execução ativa somente após confirmar a posse", async () => {
    const { ticketId, executionId } = await activeExecution();
    const guard = await createInstanceGuard(resource.database, runtimeRoot());
    await expect(recoverInterruptedExecutions(resource.database, guard)).resolves.toBe(1);
    await guard.release();

    const execution = await resource.database.pool.query(
      "SELECT status, blocker_code, outcome FROM executions WHERE id=$1",
      [executionId],
    );
    const ticket = await resource.database.pool.query("SELECT status FROM tickets WHERE id=$1", [
      ticketId,
    ]);
    const events = await resource.database.pool.query(
      "SELECT sequence,type FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [executionId],
    );
    expect(execution.rows[0]).toEqual({
      status: "interrompida",
      blocker_code: "PROCESS_RECOVERY",
      outcome: "interrupted_by_recovery",
    });
    expect(ticket.rows[0]).toEqual({ status: "aberto" });
    expect(events.rows.at(-1)).toEqual({ sequence: 2, type: "interrupted" });
  });
});
