import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubClient, type GhExecution } from "../integrations/github/cli.js";
import { createImplementationService } from "../services/implementationService.js";
import {
  implementationListInputSchema,
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
     VALUES ($1,$2,$3,1,'{}','bug','Resumo','Observado','Esperado','Regra','Diagnóstico','Próxima ação',NULL,'[]','Executar a regressão','v1',$4)`,
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

  it("lista a execução e consulta o detalhe sem expor snapshots internos", async () => {
    const ticketId = await eligibleTicket();
    const input = startImplementationSchema.parse({
      ticketId,
      expectedVersion: 1,
      requestKey: randomUUID(),
    });
    const reservation = await repository.reserve(input, environment);
    const list = await repository.list(implementationListInputSchema.parse({ ticketId }));
    expect(list).toMatchObject({ total: 1, items: [{ execution: { id: reservation.id } }] });
    const detail = await repository.byId(reservation.id);
    expect(detail).toMatchObject({
      execution: { id: reservation.id, status: "em_andamento", triageId: expect.any(String) },
      ticket: { id: ticketId, status: "em_andamento" },
      triage: { classification: "bug", regressionTestPlan: "Executar a regressão" },
      delivery: null,
    });
    expect(JSON.stringify(detail)).not.toContain("ticket_snapshot");
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

  it("dispara a workflow fora da transação e registra o evento de confirmação", async () => {
    const ticketId = await eligibleTicket();
    const execute = vi.fn<GhExecution>(async (args) => {
      if (args[0] === "auth") return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const github = createGithubClient({ execute });
    const service = createImplementationService(repository, environment, github);
    const input = startImplementationSchema.parse({
      ticketId,
      expectedVersion: 1,
      requestKey: randomUUID(),
    });

    const result = await service.start(input);

    expect(result.implementationExecutionId).toBeTypeOf("string");
    expect(execute).toHaveBeenNthCalledWith(
      3,
      [
        "workflow",
        "run",
        "main",
        "--repo",
        "equipe/alvo",
        "--ref",
        "main",
        "--field",
        `executionId=${result.implementationExecutionId}`,
        "--field",
        `ticketId=${ticketId}`,
        "--field",
        "ticketVersion=1",
      ],
      expect.anything(),
    );
    const events = await resource.database.pool.query(
      "SELECT sequence,type FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [result.implementationExecutionId],
    );
    expect(events.rows).toEqual([
      { sequence: 1, type: "started" },
      { sequence: 2, type: "workflow_dispatched" },
    ]);
    await expect(service.start(input)).resolves.toEqual(result);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("bloqueia a execução e devolve o ticket a aberto quando o disparo falha", async () => {
    const ticketId = await eligibleTicket();
    const execute = vi.fn<GhExecution>(async (args) => {
      if (args[0] === "auth") return { stdout: "", stderr: "" };
      throw new Error("falha externa fictícia");
    });
    const github = createGithubClient({ execute });
    const service = createImplementationService(repository, environment, github);
    const input = startImplementationSchema.parse({
      ticketId,
      expectedVersion: 1,
      requestKey: randomUUID(),
    });

    await expect(service.start(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("aberto");
    const execution = await resource.database.pool.query(
      "SELECT status,blocker_code FROM executions WHERE request_key=$1",
      [input.requestKey],
    );
    expect(execution.rows[0]).toEqual({
      status: "bloqueada",
      blocker_code: "WORKFLOW_DISPATCH_FAILED",
    });
  });

  it("aplica callback de sucesso uma única vez e aguarda revisão humana", async () => {
    const ticketId = await eligibleTicket();
    const reservation = await repository.reserve(
      startImplementationSchema.parse({
        ticketId,
        expectedVersion: 1,
        requestKey: randomUUID(),
      }),
      environment,
    );
    const callback = {
      schemaVersion: 1 as const,
      executionId: reservation.id,
      repository: "equipe/alvo",
      workflowId: "987654",
      workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
      status: "success" as const,
      branch: "resolva/res-1-abc",
      commitSha: "a".repeat(40),
      pullRequest: {
        number: 12,
        url: "https://github.com/equipe/alvo/pull/12",
        state: "OPEN" as const,
      },
      failureReason: null,
    };

    await expect(repository.applyPipelineCallback(callback)).resolves.toMatchObject({
      applied: true,
    });
    await expect(repository.applyPipelineCallback(callback)).resolves.toMatchObject({
      applied: false,
    });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("aguardando_revisao");
    const execution = await resource.database.pool.query(
      "SELECT status,outcome,published_sha FROM executions WHERE id=$1",
      [reservation.id],
    );
    expect(execution.rows[0]).toEqual({
      status: "concluida",
      outcome: "pipeline_succeeded",
      published_sha: "a".repeat(40),
    });
    const events = await resource.database.pool.query(
      "SELECT type FROM execution_events WHERE execution_id=$1 AND type='pipeline_callback'",
      [reservation.id],
    );
    expect(events.rowCount).toBe(1);
  });
});
