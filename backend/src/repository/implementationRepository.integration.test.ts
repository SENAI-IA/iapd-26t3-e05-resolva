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
  it("reserva a entrega com identidade estável antes de qualquer disparo", async () => {
    const ticketId = await eligibleTicket();
    const input = { ticketId, expectedVersion: 1, requestKey: randomUUID() };
    const first = await repository.reserve(input, environment);
    const detail = await repository.byId(first.id);
    expect(detail.delivery).toMatchObject({
      id: expect.any(String),
      number: 1,
      branchName: `resolva/res-${ticketId}-${first.id.slice(0, 8)}`,
      prNumber: null,
      remoteHeadSha: null,
    });
    expect(first.reservation).toMatchObject({
      deliveryId: detail.delivery?.id,
      branchName: detail.delivery?.branchName,
    });
    await repository.reserve(input, environment);
    const rows = await resource.database.pool.query(
      "SELECT first_execution_id,repository,base_branch FROM deliveries WHERE ticket_id=$1",
      [ticketId],
    );
    expect(rows.rows).toEqual([
      { first_execution_id: first.id, repository: "equipe/alvo", base_branch: "main" },
    ]);
  });

  it("consulta eventos em ordem e respeita o cursor", async () => {
    const { executionId } = await reserveImplementation();
    await resource.database.pool.query(
      `INSERT INTO execution_events(execution_id,sequence,type,stage,message,payload)
       VALUES ($1,2,'started','preparando_ambiente','Execução iniciada','{}'),
              ($1,3,'workflow_dispatched','preparando_ambiente','Workflow disparada','{}')`,
      [executionId],
    );

    await expect(
      repository.events({ executionId, afterSequence: 1, limit: 1 }),
    ).resolves.toMatchObject({
      items: [{ sequence: 2, type: "started" }],
      nextSequence: 2,
      hasMore: true,
    });
    await expect(
      repository.events({ executionId, afterSequence: 2, limit: 100 }),
    ).resolves.toMatchObject({
      items: [{ sequence: 3, type: "workflow_dispatched" }],
      nextSequence: 3,
      hasMore: false,
    });
  });

  it("faz rollback da reserva quando a entrega não pode ser criada", async () => {
    const ticketId = await eligibleTicket();
    await resource.database.pool.query(
      "ALTER TABLE deliveries ADD CONSTRAINT reject_delivery_test CHECK (number < 0)",
    );
    try {
      await expect(
        repository.reserve({ ticketId, expectedVersion: 1, requestKey: randomUUID() }, environment),
      ).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE deliveries DROP CONSTRAINT reject_delivery_test",
      );
    }
    expect((await tickets.byId(ticketId)).ticket.status).toBe("aguardando_implementacao");
    expect(
      (await resource.database.pool.query("SELECT id FROM executions WHERE kind='implementation'"))
        .rowCount,
    ).toBe(0);
  });
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
            status: "failure",
            failureReason: "Falha fictícia",
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
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
      "SELECT id FROM ticket_events WHERE ticket_id=$1 AND type='implementation_failed'",
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
      delivery: { id: expect.any(String), number: 1, prNumber: null },
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

  it("reproduz reservas concorrentes da mesma intenção sem criar entrega órfã", async () => {
    const ticketId = await eligibleTicket();
    const input = { ticketId, expectedVersion: 1, requestKey: randomUUID() };
    const [first, second] = await Promise.all([
      repository.reserve(input, environment),
      repository.reserve(input, environment),
    ]);
    expect(second.id).toBe(first.id);
    expect([first.reservation, second.reservation].filter(Boolean)).toHaveLength(1);
    expect(
      (
        await resource.database.pool.query("SELECT id FROM deliveries WHERE ticket_id=$1", [
          ticketId,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM executions WHERE kind='implementation' AND ticket_id=$1",
          [ticketId],
        )
      ).rowCount,
    ).toBe(1);
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
      if (args[0] === "api")
        return {
          stdout: JSON.stringify({
            id: 456,
            path: ".github/workflows/resolva.yml",
            state: "active",
            url: "https://api.github.com/repos/equipe/alvo/actions/workflows/456",
          }),
          stderr: "",
        };
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
    const detail = await repository.byId(result.implementationExecutionId);
    expect(execute).toHaveBeenNthCalledWith(
      4,
      [
        "workflow",
        "run",
        "456",
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
        "--field",
        `deliveryId=${detail.delivery?.id}`,
        "--field",
        `branchName=${detail.delivery?.branchName}`,
      ],
      expect.anything(),
    );
    const events = await resource.database.pool.query(
      "SELECT sequence,type FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [result.implementationExecutionId],
    );
    expect(events.rows).toEqual([
      { sequence: 1, type: "started" },
      { sequence: 2, type: "workflow_dispatch_requested" },
      { sequence: 3, type: "workflow_dispatched" },
    ]);
    await expect(service.start(input)).resolves.toEqual(result);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("bloqueia a execução e devolve o ticket a aberto quando o ambiente impede o envio", async () => {
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

  it("não aprova retrospectivamente uma execução legada sem entrega", async () => {
    const { executionId, ticketId } = await reserveImplementation();
    await resource.database.pool.query("UPDATE executions SET delivery_id=NULL WHERE id=$1", [
      executionId,
    ]);
    const service = createImplementationService(repository, environment);
    await expect(
      service.applyCallback(
        pipelineCallback(executionId, {
          status: "success",
          branch: "resolva/res-1-abc",
          commitSha: "a".repeat(40),
          pullRequest: { number: 12, url: "https://github.com/equipe/alvo/pull/12", state: "OPEN" },
        }),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await tickets.byId(ticketId)).ticket.status).toBe("em_andamento");
    expect((await repository.byId(executionId)).execution.status).toBe("em_andamento");
  });
});
