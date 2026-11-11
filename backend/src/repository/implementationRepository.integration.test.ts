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
import type { PipelineCallback } from "../integrations/ci/callback.js";
import { createServer } from "../server.js";

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

async function reserveImplementation() {
  const ticketId = await eligibleTicket();
  const { id } = await repository.reserve(
    { ticketId, expectedVersion: 1, requestKey: randomUUID() },
    environment,
  );
  return { executionId: id, ticketId };
}

function pipelineCallback(
  executionId: string,
  overrides: Partial<PipelineCallback> = {},
): PipelineCallback {
  return {
    schemaVersion: 1,
    executionId,
    repository: "equipe/alvo",
    workflowId: "987654",
    workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    status: "queued",
    branch: null,
    commitSha: null,
    pullRequest: null,
    failureReason: null,
    ...overrides,
  };
}

describe("implementação transacional", () => {
  it.each([
    [
      "outro repositório",
      {
        repository: "outro/alvo",
        workflowUrl: "https://github.com/outro/alvo/actions/runs/987654",
      },
    ],
    ["sucesso sem PR ou SHA", { status: "success" as const }],
    ["falha sem diagnóstico", { status: "failure" as const }],
    [
      "URL com segredo",
      { workflowUrl: "https://ficticio@github.com/equipe/alvo/actions/runs/987654" },
    ],
  ])("recusa callback de %s e preserva a execução", async (_name, overrides) => {
    const { executionId, ticketId } = await reserveImplementation();
    await expect(
      repository.applyPipelineCallback(pipelineCallback(executionId, overrides)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repository.byId(executionId)).execution).toMatchObject({
      status: "em_andamento",
      outcome: null,
    });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("em_andamento");
    const events = await resource.database.pool.query(
      "SELECT id FROM execution_events WHERE execution_id=$1 AND type='pipeline_callback'",
      [executionId],
    );
    expect(events.rowCount).toBe(0);
  });

  it("usa o snapshot da execução mesmo após mudança na configuração do ticket", async () => {
    const { executionId, ticketId } = await reserveImplementation();
    await resource.database.pool.query(
      "UPDATE tickets SET target_config_snapshot=jsonb_set(target_config_snapshot, '{repository}', '\"outro/alvo\"') WHERE id=$1",
      [ticketId],
    );
    await expect(
      repository.applyPipelineCallback(pipelineCallback(executionId)),
    ).resolves.toMatchObject({ applied: true });
    expect((await repository.byId(executionId)).execution).toMatchObject({
      workflowId: "987654",
      workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    });
  });

  it("bloqueia callback quando o snapshot não identifica o repositório", async () => {
    const { executionId } = await reserveImplementation();
    await resource.database.pool.query("UPDATE executions SET config_snapshot='{}' WHERE id=$1", [
      executionId,
    ]);
    await expect(
      repository.applyPipelineCallback(pipelineCallback(executionId)),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("vincula um único workflow e rejeita troca de identidade", async () => {
    const { executionId } = await reserveImplementation();
    await repository.applyPipelineCallback(pipelineCallback(executionId));
    await expect(
      repository.applyPipelineCallback(
        pipelineCallback(executionId, {
          workflowId: "987655",
          workflowUrl: "https://github.com/equipe/alvo/actions/runs/987655",
          status: "running",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("ignora replay antigo e recusa regressão de running para queued", async () => {
    const { executionId } = await reserveImplementation();
    const queued = pipelineCallback(executionId);
    const first = await repository.applyPipelineCallback(queued);
    await repository.applyPipelineCallback(pipelineCallback(executionId, { status: "running" }));
    await expect(repository.applyPipelineCallback(queued)).resolves.toEqual({
      applied: false,
      fingerprint: first.fingerprint,
    });
    await expect(
      repository.applyPipelineCallback(
        pipelineCallback(executionId, { branch: "resolva/atrasada" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(executionId)).execution.outcome).toBe("pipeline_running");
  });

  it("replay intermediário após falha é inócuo e outro término gera conflito", async () => {
    const { executionId, ticketId } = await reserveImplementation();
    const running = pipelineCallback(executionId, { status: "running" });
    await repository.applyPipelineCallback(running);
    const failed = pipelineCallback(executionId, {
      status: "failure",
      failureReason: "Credencial fictícia: nao-persistir",
    });
    await repository.applyPipelineCallback(failed);
    await expect(repository.applyPipelineCallback(running)).resolves.toMatchObject({
      applied: false,
    });
    await expect(repository.applyPipelineCallback(failed)).resolves.toMatchObject({
      applied: false,
    });
    await expect(
      repository.applyPipelineCallback({ ...failed, status: "cancelled" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("aberto");
    const events = await resource.database.pool.query(
      "SELECT payload,message FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [executionId],
    );
    expect(JSON.stringify(events.rows)).not.toContain("nao-persistir");
    expect(events.rowCount).toBe(3);
  });

  it("serializa callbacks concorrentes sem duplicar eventos", async () => {
    const { executionId } = await reserveImplementation();
    const callback = pipelineCallback(executionId, { status: "running" });
    const results = await Promise.all([
      repository.applyPipelineCallback(callback),
      repository.applyPipelineCallback(callback),
    ]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    const events = await resource.database.pool.query(
      "SELECT sequence FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [executionId],
    );
    expect(events.rows).toEqual([{ sequence: 1 }, { sequence: 2 }]);
  });

  it("faz rollback da identidade, conclusão e ticket quando o evento não pode ser gravado", async () => {
    const { executionId, ticketId } = await reserveImplementation();
    await resource.database.pool.query(
      "ALTER TABLE execution_events ADD CONSTRAINT callback_test_failure CHECK (type <> 'pipeline_callback')",
    );
    try {
      await expect(
        repository.applyPipelineCallback(
          pipelineCallback(executionId, {
            status: "success",
            branch: "resolva/res-1",
            commitSha: "a".repeat(40),
            pullRequest: {
              number: 12,
              url: "https://github.com/equipe/alvo/pull/12",
              state: "OPEN",
            },
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE execution_events DROP CONSTRAINT callback_test_failure",
      );
    }
    expect((await repository.byId(executionId)).execution).toMatchObject({
      status: "em_andamento",
      outcome: null,
      workflowId: null,
      workflowUrl: null,
      completedAt: null,
    });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("em_andamento");
    const history = await resource.database.pool.query(
      "SELECT id FROM ticket_events WHERE ticket_id=$1 AND type='implementation_ready_for_review'",
      [ticketId],
    );
    expect(history.rowCount).toBe(0);
  });

  it("registra confirmação de disparo após callback sem colidir ou duplicar eventos", async () => {
    const { executionId } = await reserveImplementation();
    await repository.applyPipelineCallback(pipelineCallback(executionId, { status: "running" }));
    await repository.markWorkflowDispatched(executionId);
    await repository.markWorkflowDispatched(executionId);
    const events = await resource.database.pool.query(
      "SELECT sequence,type FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [executionId],
    );
    expect(events.rows).toEqual([
      { sequence: 1, type: "started" },
      { sequence: 2, type: "pipeline_callback" },
      { sequence: 3, type: "workflow_dispatched" },
    ]);
  });

  it("preserva workflow confirmada por callback quando a resposta do disparo se perde", async () => {
    const { executionId, ticketId } = await reserveImplementation();
    await repository.applyPipelineCallback(pipelineCallback(executionId, { status: "running" }));
    await repository.blockWorkflowDispatch(executionId);
    expect((await repository.byId(executionId)).execution).toMatchObject({
      status: "em_andamento",
      outcome: "pipeline_running",
      workflowId: "987654",
    });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("em_andamento");
    const events = await resource.database.pool.query(
      "SELECT sequence,type FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [executionId],
    );
    expect(events.rows).toEqual([
      { sequence: 1, type: "started" },
      { sequence: 2, type: "pipeline_callback" },
    ]);
  });

  it("expõe erro público e identidade do workflow por HTTP", async () => {
    const { executionId } = await reserveImplementation();
    const service = createImplementationService(repository, environment);
    const server = createServer({ implementationService: service });
    try {
      const invalid = await server.inject({
        method: "POST",
        url: "/trpc/implementations.callback",
        headers: { host: "127.0.0.1:3000" },
        payload: pipelineCallback(executionId, { status: "success" }),
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.data.code).toBe("BAD_REQUEST");
      const valid = await server.inject({
        method: "POST",
        url: "/trpc/implementations.callback",
        headers: { host: "127.0.0.1:3000" },
        payload: pipelineCallback(executionId),
      });
      expect(valid.statusCode).toBe(200);
      const detail = await server.inject({
        method: "GET",
        url: `/trpc/implementations.byId?input=${encodeURIComponent(JSON.stringify({ executionId }))}`,
        headers: { host: "127.0.0.1:3000" },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().result.data.execution.workflowId).toBe("987654");
    } finally {
      await server.close();
    }
  });

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
