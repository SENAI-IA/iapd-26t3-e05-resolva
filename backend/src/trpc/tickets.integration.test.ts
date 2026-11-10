import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ticketDetailsSchema,
  ticketEventsSchema,
  ticketListSchema,
  ticketSchema,
} from "../domain/contracts.js";
import { createTicketRepository } from "../repository/ticketRepository.js";
import { createServer } from "../server.js";
import { createTicketService } from "../services/ticketService.js";
import { startTestDatabase } from "../test/database.js";
import { testTargetConfig } from "../test/projectConfig.js";

const content = {
  targetSystemKey: "demo",
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "Multiplicar preço pela quantidade.",
  category: "calculo",
};
let resource: Awaited<ReturnType<typeof startTestDatabase>>;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  resource = await startTestDatabase();
  server = createServer({
    ticketService: createTicketService(
      createTicketRepository(resource.database),
      testTargetConfig.categories.map((category) => category.slug),
      testTargetConfig,
    ),
  });
});
afterAll(async () => {
  try {
    await server?.close();
  } finally {
    await resource?.stop();
  }
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});

function call(procedure: string, input: unknown, mutation = false) {
  return server.inject({
    method: mutation ? "POST" : "GET",
    url: `/trpc/tickets.${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
    headers: {
      host: "127.0.0.1:3000",
      ...(mutation ? { "content-type": "application/json" } : {}),
    },
    ...(mutation ? { payload: JSON.stringify(input) } : {}),
  });
}

async function create() {
  const response = await call("create", content, true);
  expect(response.statusCode).toBe(200);
  return ticketSchema.parse(response.json<{ result: { data: unknown } }>().result.data);
}

describe("tickets tRPC por HTTP", () => {
  it("cadastra, consulta e recupera histórico com contratos públicos e datas ISO", async () => {
    const ticket = await create();
    expect(ticket).toMatchObject({
      code: "RES-001",
      status: "aberto",
      version: 1,
      targetSystemKey: "demo",
      targetConfigVersion: 1,
    });
    const detail = await call("byId", { ticketId: ticket.id });
    expect(detail.statusCode).toBe(200);
    expect(
      ticketDetailsSchema.parse(detail.json<{ result: { data: unknown } }>().result.data),
    ).toMatchObject({ ticket: { id: ticket.id }, latestExecution: null, currentDelivery: null });
    const events = await call("events", { ticketId: ticket.id });
    expect(
      ticketEventsSchema.parse(events.json<{ result: { data: unknown } }>().result.data).total,
    ).toBe(1);
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(0);
  });
  it.each([
    { ...content, title: "Cur" },
    { ...content, category: "desconhecida" },
    { ...content, status: "resolvido" },
  ])("recusa entrada inválida sem gravar dados parciais", async (input) => {
    const response = await call("create", input, true);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { data: { code: "BAD_REQUEST" } } });
    expect((await resource.database.pool.query("SELECT id FROM tickets")).rowCount).toBe(0);
    expect((await resource.database.pool.query("SELECT id FROM ticket_events")).rowCount).toBe(0);
  });
  it("lista e busca literalmente, com paginação validada", async () => {
    await create();
    await call("create", { ...content, title: "Erro literal % na soma" }, true);
    const response = await call("list", { q: "%", pageSize: 1 });
    const result = ticketListSchema.parse(
      response.json<{ result: { data: unknown } }>().result.data,
    );
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.items[0]?.title).toBe("Erro literal % na soma");
    expect((await call("list", { pageSize: 51 })).statusCode).toBe(400);
    expect((await call("list", { page: 0 })).statusCode).toBe(400);
    expect((await call("list", { status: "desconhecido" })).statusCode).toBe(400);
  });
  it("atualiza versão e informa conflito sem sobrescrever dados", async () => {
    const ticket = await create();
    expect(
      (
        await call(
          "update",
          { ...content, ticketId: ticket.id, expectedVersion: 1, title: "Título atualizado" },
          true,
        )
      ).statusCode,
    ).toBe(200);
    const conflict = await call(
      "update",
      { ...content, ticketId: ticket.id, expectedVersion: 1 },
      true,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { data: { code: "CONFLICT" } } });
    expect((await call("byId", { ticketId: 999 })).statusCode).toBe(404);
    expect((await call("events", { ticketId: 999 })).statusCode).toBe(404);
  });
  it("exige confirmação humana e justificativa para reabrir", async () => {
    const ticket = await create();
    await resource.database.pool.query(
      "UPDATE tickets SET status='aguardando_revisao' WHERE id=$1",
      [ticket.id],
    );
    const identity = { ticketId: ticket.id, expectedVersion: 1 };
    expect(
      (await call("resolve", { ...identity, mergeConfirmed: true, testVerified: false }, true))
        .statusCode,
    ).toBe(400);
    expect(
      (await call("resolve", { ...identity, mergeConfirmed: true, testVerified: true }, true))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("reopen", { ticketId: ticket.id, expectedVersion: 2, message: " " }, true))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          "reopen",
          { ticketId: ticket.id, expectedVersion: 2, message: "O erro retornou." },
          true,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("complementa sem disparar IA e recusa contestação sem triagem recusada", async () => {
    const ticket = await create();
    await resource.database.pool.query(
      "UPDATE tickets SET status='aguardando_informacoes' WHERE id=$1",
      [ticket.id],
    );
    const response = await call(
      "provideInformation",
      { ticketId: ticket.id, expectedVersion: 1, message: "Utilizei quantidade 2." },
      true,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: { data: { status: "aberto", version: 2 } } });
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(0);
    expect(
      (
        await call(
          "contestTriage",
          { ticketId: ticket.id, expectedVersion: 2, message: "Nova evidência" },
          true,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("não expõe erros de validação, query, stack ou parâmetros secretos", async () => {
    const invalid = await call(
      "create",
      { ...content, "segredo-ficticio": "token-ficticio" },
      true,
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain("segredo-ficticio");
    expect(invalid.body).not.toContain("stack");
    await resource.database.pool
      .query(`CREATE FUNCTION reject_ticket_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'senha-interna-ficticia'; END $$;
      CREATE TRIGGER reject_ticket_insert BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION reject_ticket_insert()`);
    try {
      const response = await call("create", content, true);
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: {
          message: "Não foi possível concluir a solicitação.",
          data: { code: "INTERNAL_SERVER_ERROR" },
        },
      });
      expect(response.body).not.toContain("senha-interna-ficticia");
      expect(response.body).not.toContain("INSERT INTO");
      expect(response.body).not.toContain("stack");
    } finally {
      await resource.database.pool.query(
        "DROP TRIGGER reject_ticket_insert ON tickets; DROP FUNCTION reject_ticket_insert()",
      );
    }
  });
  it("aceita categorias do operador sem configuração de IA", async () => {
    const configured = createServer({
      ticketService: createTicketService(
        createTicketRepository(resource.database),
        ["categoria_customizada"],
        testTargetConfig,
      ),
    });
    try {
      const response = await configured.inject({
        method: "POST",
        url: "/trpc/tickets.create",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        payload: JSON.stringify({ ...content, category: "categoria_customizada" }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        result: { data: { category: "categoria_customizada" } },
      });
    } finally {
      await configured.close();
    }
  });
  it("preserva healthcheck e informa pré-condição quando o banco não foi configurado", async () => {
    const unavailable = createServer();
    try {
      const response = await unavailable.inject({
        method: "GET",
        url: "/trpc/tickets.list",
        headers: { host: "localhost:3000" },
      });
      expect(response.statusCode).toBe(412);
      expect(response.json()).toMatchObject({ error: { data: { code: "PRECONDITION_FAILED" } } });
      expect(
        (
          await unavailable.inject({
            method: "GET",
            url: "/rest/health",
            headers: { host: "localhost:3000" },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await unavailable.close();
    }
  });
});
