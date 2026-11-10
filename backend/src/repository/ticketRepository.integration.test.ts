import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listTicketsSchema, ticketEventsInputSchema } from "../domain/contracts.js";
import { startTestDatabase } from "../test/database.js";
import { testTargetSnapshot } from "../test/projectConfig.js";
import { createTicketRepository } from "./ticketRepository.js";

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
let repository: ReturnType<typeof createTicketRepository>;
const content = {
  targetSystemKey: "demo",
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "Multiplicar preço pela quantidade.",
  reproductionSteps: null,
  category: "calculo",
};

beforeAll(async () => {
  resource = await startTestDatabase();
  repository = createTicketRepository(resource.database);
});
afterAll(async () => {
  await resource?.stop();
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});

async function triage(ticketId: number, classification = "bug") {
  const executionId = randomUUID();
  const triageId = randomUUID();
  await resource.database.pool.query(
    `INSERT INTO executions(id,ticket_id,ticket_version,kind,request_key,status,ticket_snapshot,config_snapshot)
    VALUES ($1,$2,1,'triage',$3,'concluida','{}','{"segredo":"segredo-interno-ficticio"}')`,
    [executionId, ticketId, randomUUID()],
  );
  await resource.database.pool.query(
    `INSERT INTO triages(id,ticket_id,execution_id,ticket_version,ticket_snapshot,classification,summary,observed_behavior,expected_behavior,rule_interpretation,diagnosis,next_action,prompt_version)
    VALUES ($1,$2,$3,1,'{"version":1}',$4,'Resumo','Observado','Esperado','Regra','Diagnóstico','Próxima ação','v1')`,
    [triageId, ticketId, executionId, classification],
  );
  await resource.database.pool.query(
    "UPDATE tickets SET current_triage_id=$1,classification=$2 WHERE id=$3",
    [triageId, classification, ticketId],
  );
  return triageId;
}

describe("tickets transacionais", () => {
  it("cria ticket aberto e histórico na mesma transação sem iniciar execução", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    expect(ticket).toMatchObject({
      id: 1,
      code: "RES-001",
      status: "aberto",
      version: 1,
      classification: null,
      triageStatus: null,
    });
    const events = await repository.events(ticketEventsInputSchema.parse({ ticketId: ticket.id }));
    expect(events.total).toBe(1);
    expect(events.items[0]).toMatchObject({
      type: "created",
      fromStatus: null,
      toStatus: "aberto",
    });
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(0);
  });
  it("devolve NOT_FOUND para ticket e histórico inexistentes", async () => {
    await expect(repository.byId(999)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      repository.events(ticketEventsInputSchema.parse({ ticketId: 999 })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("não sobrescreve duas edições concorrentes da mesma versão", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    const results = await Promise.allSettled(
      ["Primeira edição", "Segunda edição"].map((title) =>
        repository.mutate({
          ticketId: ticket.id,
          expectedVersion: 1,
          type: "edit",
          content: { ...content, title },
          targetConfigSnapshot: testTargetSnapshot,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect((await repository.byId(ticket.id)).ticket.version).toBe(2);
    expect(
      (await repository.events(ticketEventsInputSchema.parse({ ticketId: ticket.id }))).total,
    ).toBe(2);
  });
  it("invalida triagem sem apagar a conclusão e preserva snapshot imutável", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    const triageId = await triage(ticket.id);
    const updated = await repository.mutate({
      ticketId: ticket.id,
      expectedVersion: 1,
      type: "edit",
      content: { ...content, title: "Novo relato do defeito" },
      targetConfigSnapshot: testTargetSnapshot,
    });
    expect(updated).toMatchObject({
      version: 2,
      classification: "bug",
      currentTriageId: triageId,
      triageStatus: "invalidated",
      triageVersion: 1,
    });
    const result = await resource.database.pool.query(
      "SELECT summary,ticket_snapshot,invalidated_at FROM triages WHERE id=$1",
      [triageId],
    );
    expect(result.rows[0]).toMatchObject({ summary: "Resumo", ticket_snapshot: { version: 1 } });
    expect(result.rows[0]?.invalidated_at).toBeInstanceOf(Date);
    const details = await repository.byId(ticket.id);
    expect(details.latestExecution).toMatchObject({ kind: "triage", status: "concluida" });
    expect(JSON.stringify(details)).not.toContain("segredo-interno-ficticio");
  });
  it("reverte conteúdo, triagem e versão se falhar a gravação do evento", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    await triage(ticket.id);
    await resource.database.pool
      .query(`CREATE FUNCTION reject_ticket_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha-ficticia'; END $$;
      CREATE TRIGGER reject_ticket_event BEFORE INSERT ON ticket_events FOR EACH ROW EXECUTE FUNCTION reject_ticket_event()`);
    try {
      await expect(
        repository.mutate({
          ticketId: ticket.id,
          expectedVersion: 1,
          type: "edit",
          content: { ...content, title: "Edição revertida" },
          targetConfigSnapshot: testTargetSnapshot,
        }),
      ).rejects.toThrow();
      await expect(
        repository.create({ ...content, title: "Criação revertida" }, testTargetSnapshot),
      ).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "DROP TRIGGER reject_ticket_event ON ticket_events; DROP FUNCTION reject_ticket_event()",
      );
    }
    expect((await repository.byId(ticket.id)).ticket).toMatchObject({
      title: content.title,
      version: 1,
      triageStatus: "valid",
    });
    expect((await repository.list(listTicketsSchema.parse({}))).total).toBe(1);
  });
  it.each(["%", "_", "\\", "' OR 1=1 --"])(
    "busca %s literalmente sem tratar conteúdo como SQL",
    async (q) => {
      const expected = await repository.create(
        { ...content, title: `Ticket literal ${q}` },
        testTargetSnapshot,
      );
      await repository.create({ ...content, title: "Outro ticket da lista" }, testTargetSnapshot);
      const result = await repository.list(listTicketsSchema.parse({ q }));
      expect(result.items.map((item) => item.id)).toEqual([expected.id]);
      expect(result.total).toBe(1);
    },
  );
  it("pagina com desempate por ID, filtra e encontra código visual", async () => {
    const first = await repository.create(content, testTargetSnapshot);
    const second = await repository.create(
      {
        ...content,
        title: "Outro ticket",
        category: "regra_negocio",
      },
      testTargetSnapshot,
    );
    await resource.database.pool.query("UPDATE tickets SET updated_at='2026-01-01T00:00:00Z'");
    const page1 = await repository.list(listTicketsSchema.parse({ pageSize: 1 }));
    const page2 = await repository.list(listTicketsSchema.parse({ page: 2, pageSize: 1 }));
    expect(page1).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page1.items[0]?.id).toBe(second.id);
    expect(page2.items[0]?.id).toBe(first.id);
    expect(
      (await repository.list(listTicketsSchema.parse({ category: "calculo" }))).items.map(
        (ticket) => ticket.id,
      ),
    ).toEqual([first.id]);
    expect((await repository.list(listTicketsSchema.parse({ q: "res-001" }))).items[0]?.id).toBe(
      first.id,
    );
    expect((await repository.list(listTicketsSchema.parse({ status: "resolvido" }))).total).toBe(0);
  });
  it("complementa informações e contesta sem criar execução ou apagar a mensagem anterior", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    await triage(ticket.id, "inconclusivo");
    await resource.database.pool.query(
      "UPDATE tickets SET status='aguardando_informacoes' WHERE id=$1",
      [ticket.id],
    );
    const result = await repository.mutate({
      ticketId: ticket.id,
      expectedVersion: 1,
      type: "provide_information",
      message: "Quantidade usada: duas unidades.",
    });
    expect(result).toMatchObject({ status: "aberto", version: 2, triageStatus: "invalidated" });
    const events = await repository.events(ticketEventsInputSchema.parse({ ticketId: ticket.id }));
    expect(events.items.at(-1)).toMatchObject({
      type: "information_provided",
      message: "Quantidade usada: duas unidades.",
    });
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(1);
    const refused = await repository.create(content, testTargetSnapshot);
    await triage(refused.id, "falso_positivo");
    await resource.database.pool.query("UPDATE tickets SET status='recusado' WHERE id=$1", [
      refused.id,
    ]);
    expect(
      await repository.mutate({
        ticketId: refused.id,
        expectedVersion: 1,
        type: "contest_triage",
        message: "Tenho uma evidência nova.",
      }),
    ).toMatchObject({ status: "aberto", version: 2, triageStatus: "invalidated" });
  });
  it("recusa edição em execução e resolução sem ambas as confirmações", async () => {
    const ticket = await repository.create(content, testTargetSnapshot);
    await resource.database.pool.query("UPDATE tickets SET status='em_andamento' WHERE id=$1", [
      ticket.id,
    ]);
    await expect(
      repository.mutate({
        ticketId: ticket.id,
        expectedVersion: 1,
        type: "edit",
        content,
        targetConfigSnapshot: testTargetSnapshot,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await resource.database.pool.query(
      "UPDATE tickets SET status='aguardando_revisao' WHERE id=$1",
      [ticket.id],
    );
    await expect(
      repository.mutate({
        ticketId: ticket.id,
        expectedVersion: 1,
        type: "resolve",
        mergeConfirmed: true,
        testVerified: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const resolved = await repository.mutate({
      ticketId: ticket.id,
      expectedVersion: 1,
      type: "resolve",
      mergeConfirmed: true,
      testVerified: true,
    });
    expect(resolved).toMatchObject({ status: "resolvido", version: 2 });
    expect(resolved.resolvedAt).toMatch(/Z$/u);
    expect(
      await repository.mutate({
        ticketId: ticket.id,
        expectedVersion: 2,
        type: "reopen",
        message: "O erro voltou após a verificação.",
      }),
    ).toMatchObject({ status: "aberto", version: 3, resolvedAt: null });
  });
});
