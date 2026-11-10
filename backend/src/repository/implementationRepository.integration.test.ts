import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  implementationQueueInputSchema,
  startImplementationSchema,
} from "../domain/implementationContracts.js";
import { startTestDatabase } from "../test/database.js";
import { testTargetSnapshot } from "../test/projectConfig.js";
import { createTicketRepository } from "./ticketRepository.js";
import { createImplementationRepository } from "./implementationRepository.js";

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
let tickets: ReturnType<typeof createTicketRepository>;
let repository: ReturnType<typeof createImplementationRepository>;
const content = {
  targetSystemKey: "demo",
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "Multiplicar preço pela quantidade.",
  reproductionSteps: null,
  category: "calculo",
};
const sourcePath = "src/orders/total.ts";
const sourceHash = "a".repeat(64);
const environment = { ready: true, sourceHashes: { [sourcePath]: sourceHash } };

beforeAll(async () => {
  resource = await startTestDatabase();
  tickets = createTicketRepository(resource.database);
  repository = createImplementationRepository(resource.database);
});
afterAll(async () => {
  await resource?.stop();
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});

async function eligibleTicket() {
  const ticket = await tickets.create(content, testTargetSnapshot);
  const executionId = randomUUID();
  const triageId = randomUUID();
  await resource.database.pool.query(
    `INSERT INTO executions(id,ticket_id,ticket_version,kind,request_key,status,ticket_snapshot,config_snapshot)
     VALUES ($1,$2,1,'triage',$3,'concluida','{}','{}')`,
    [executionId, ticket.id, randomUUID()],
  );
  await resource.database.pool.query(
    `INSERT INTO triages(id,ticket_id,execution_id,ticket_version,ticket_snapshot,classification,summary,observed_behavior,expected_behavior,rule_interpretation,diagnosis,next_action,change_scope,acceptance_criteria,regression_test_plan,prompt_version,source_hashes)
     VALUES ($1,$2,$3,1,'{}','bug','Resumo','Observado','Esperado','Regra','Diagnóstico','Próxima ação',NULL,'{}','Executar a regressão','v1',$4)`,
    [triageId, ticket.id, executionId, JSON.stringify({ [sourcePath]: sourceHash })],
  );
  await resource.database.pool.query(
    "UPDATE tickets SET current_triage_id=$1,classification='bug',status='aguardando_implementacao' WHERE id=$2",
    [triageId, ticket.id],
  );
  return ticket.id;
}

describe("implementação transacional", () => {
  it("lista o ticket na fila e informa a elegibilidade", async () => {
    const ticketId = await eligibleTicket();
    const result = await repository.queue(implementationQueueInputSchema.parse({}), environment);
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 15 });
    expect(result.items[0]).toMatchObject({
      ticket: { id: ticketId, status: "aguardando_implementacao" },
      eligibility: { eligible: true },
    });
  });

  it("reserva implementação, muda o estado e grava snapshots e eventos", async () => {
    const ticketId = await eligibleTicket();
    const input = startImplementationSchema.parse({
      ticketId,
      expectedVersion: 1,
      requestKey: randomUUID(),
    });
    const result = await repository.reserve(input, environment);
    expect(result.reservation).toMatchObject({ executionId: result.id, ticketId });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("em_andamento");
    const execution = await resource.database.pool.query(
      "SELECT kind,status,stage,ticket_snapshot FROM executions WHERE id=$1",
      [result.id],
    );
    expect(execution.rows[0]).toMatchObject({
      kind: "implementation",
      status: "em_andamento",
      stage: "preparando_ambiente",
    });
    expect(execution.rows[0]?.ticket_snapshot.triage.classification).toBe("bug");
    const events = await resource.database.pool.query(
      "SELECT type FROM ticket_events WHERE ticket_id=$1 ORDER BY created_at,id",
      [ticketId],
    );
    expect(events.rows.at(-1)?.type).toBe("implementation_started");
  });

  it("reproduz a mesma reserva pela requestKey sem criar outra execução", async () => {
    const ticketId = await eligibleTicket();
    const input = startImplementationSchema.parse({
      ticketId,
      expectedVersion: 1,
      requestKey: randomUUID(),
    });
    const first = await repository.reserve(input, environment);
    const replay = await repository.reserve(input, environment);
    expect(replay).toMatchObject({ id: first.id, reservation: null });
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(2);
  });

  it("recusa outra implementação enquanto há execução ativa", async () => {
    const firstTicketId = await eligibleTicket();
    const secondTicketId = await eligibleTicket();
    await repository.reserve(
      startImplementationSchema.parse({
        ticketId: firstTicketId,
        expectedVersion: 1,
        requestKey: randomUUID(),
      }),
      environment,
    );
    await expect(
      repository.reserve(
        startImplementationSchema.parse({
          ticketId: secondTicketId,
          expectedVersion: 1,
          requestKey: randomUUID(),
        }),
        environment,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", activeExecutionId: expect.any(String) });
  });
});
