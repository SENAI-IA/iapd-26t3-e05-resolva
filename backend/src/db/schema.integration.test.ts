import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./index.js";
import { migrateDatabase } from "./migrate.js";

let container: StartedPostgreSqlContainer | undefined;
let database: AppDatabase;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createDatabase(container.getConnectionUri());
  await migrateDatabase(database);
});

afterAll(async () => {
  try {
    await database?.close();
  } finally {
    await container?.stop();
  }
});

async function ticket() {
  const result = await database.pool.query<{ id: number }>(
    `INSERT INTO tickets (title, description, expected_behavior, category)
     VALUES ('Quantidade incorreta', 'Descrição suficiente para um ticket', 'Total conforme a quantidade', 'calculo') RETURNING id`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("Ticket não retornado.");
  return row.id;
}

async function execution(
  ticketId: number,
  requestKey: string,
  status = "concluida",
  kind = "triage",
) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO executions (ticket_id, ticket_version, kind, request_key, status, ticket_snapshot)
     VALUES ($1, 1, $2, $3, $4, '{"version":1}') RETURNING id`,
    [ticketId, kind, requestKey, status],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Execução não retornada.");
  return row.id;
}

describe("schema e migrações PostgreSQL", () => {
  it("cria sete tabelas e reaplica migrações sem perder registros", async () => {
    const result = await database.pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    expect(result.rows.map((row) => row.tablename)).toEqual([
      "artifacts",
      "deliveries",
      "execution_events",
      "executions",
      "ticket_events",
      "tickets",
      "triages",
    ]);
    const id = await ticket();
    await migrateDatabase(database);
    expect((await database.pool.query("SELECT id FROM tickets WHERE id=$1", [id])).rowCount).toBe(
      1,
    );
  });

  it("persiste defaults e datas UTC após fechar e reabrir conexão", async () => {
    const id = await ticket();
    await database.close();
    if (!container) throw new Error("Contêiner ausente.");
    database = createDatabase(container.getConnectionUri());
    const result = await database.pool.query<{ status: string; version: number; created_at: Date }>(
      "SELECT status, version, created_at FROM tickets WHERE id=$1",
      [id],
    );
    expect(result.rows[0]).toMatchObject({ status: "aberto", version: 1 });
    expect(result.rows[0]?.created_at.toISOString()).toMatch(/Z$/u);
  });

  it("recusa FKs ausentes e exclusão de histórico vinculado", async () => {
    await expect(
      database.pool.query(
        "INSERT INTO ticket_events (ticket_id, type, message) VALUES (-1, 'created', 'Criação')",
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const id = await ticket();
    await database.pool.query(
      "INSERT INTO ticket_events (ticket_id, type, message) VALUES ($1, 'created', 'Criação')",
      [id],
    );
    await expect(
      database.pool.query("DELETE FROM tickets WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("preserva unicidade global da requestKey e aceita somente uma execução ativa", async () => {
    const one = await ticket();
    const two = await ticket();
    const requestKey = randomUUID();
    const active = await execution(one, requestKey, "em_andamento");
    try {
      await expect(execution(two, requestKey)).rejects.toMatchObject({ code: "23505" });
      await expect(
        execution(two, randomUUID(), "em_andamento", "implementation"),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await database.pool.query("UPDATE executions SET status='interrompida' WHERE id=$1", [
        active,
      ]);
    }
    await expect(execution(two, randomUUID(), "concluida")).resolves.toEqual(expect.any(String));
  });

  it("reserva uma única execução quando duas conexões disputam tickets diferentes", async () => {
    const ids = [await ticket(), await ticket()];
    const results = await Promise.allSettled(
      ids.map((id) => execution(id, randomUUID(), "em_andamento")),
    );
    try {
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
        code: "23505",
      });
    } finally {
      await database.pool.query(
        "UPDATE executions SET status='interrompida' WHERE ticket_id=ANY($1)",
        [ids],
      );
    }
  });

  it("faz rollback de ticket e evento na mesma transação", async () => {
    const client = await database.pool.connect();
    let id: number | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: number }>(
        "INSERT INTO tickets(title, description, expected_behavior, category) VALUES ('Falha', 'Descrição', 'Esperado', 'calculo') RETURNING id",
      );
      id = result.rows[0]?.id;
      await expect(
        client.query(
          "INSERT INTO ticket_events (ticket_id, type, message) VALUES (-1, 'created', 'Criação')",
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await database.pool.query("SELECT id FROM tickets WHERE id=$1", [id])).rowCount).toBe(
      0,
    );
  });

  it("mantém triagem vinculada à versão e conclusão no histórico", async () => {
    const ticketId = await ticket();
    const executionId = await execution(ticketId, randomUUID());
    const id = randomUUID();
    await database.pool.query(
      `INSERT INTO triages(id, ticket_id, execution_id, ticket_version, classification, summary,
       observed_behavior, expected_behavior, rule_interpretation, diagnosis, next_action, prompt_version, ticket_snapshot)
       VALUES ($1,$2,$3,1,'bug','Quantidade ignorada','Total menor','Total por quantidade','Multiplicar preço','Quantidade omitida','Implementar manualmente','v1','{"version":1}')`,
      [id, ticketId, executionId],
    );
    await database.pool.query(
      "UPDATE tickets SET current_triage_id=$1, classification='bug' WHERE id=$2",
      [id, ticketId],
    );
    await database.pool.query(
      "UPDATE triages SET status='invalidated', invalidated_at=now() WHERE id=$1",
      [id],
    );
    const result = await database.pool.query(
      "SELECT ticket_version, classification, status, ticket_snapshot FROM triages WHERE id=$1",
      [id],
    );
    expect(result.rows[0]).toMatchObject({
      ticket_version: 1,
      classification: "bug",
      status: "invalidated",
      ticket_snapshot: { version: 1 },
    });
    await expect(
      database.pool.query("DELETE FROM triages WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("recusa estados e versões inválidos e sequências de evento repetidas", async () => {
    const id = await ticket();
    await expect(
      database.pool.query("UPDATE tickets SET status='desconhecido' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      database.pool.query("UPDATE tickets SET version=0 WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: "23514" });
    const executionId = await execution(id, randomUUID());
    const insert = () =>
      database.pool.query(
        "INSERT INTO execution_events (execution_id, sequence, type, message) VALUES ($1,1,'started','Início')",
        [executionId],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.pool.query(
        "INSERT INTO execution_events(execution_id, sequence, type, message) VALUES ($1,0,'started','Início')",
        [executionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
