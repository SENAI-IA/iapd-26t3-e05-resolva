import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../test/database.js";
import {
  eligibleImplementationTicket,
  implementationEnvironment,
  implementationEvidence,
} from "../test/implementation.js";
import { createImplementationRepository } from "./implementationRepository.js";
import { createImplementationService } from "../services/implementationService.js";
import { createGithubClient, GithubCliError } from "../integrations/github/cli.js";
import { githubWorkflowRun, githubPullRequest, githubBranch } from "../test/github.js";
import { createServer } from "../server.js";

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
let repository: ReturnType<typeof createImplementationRepository>;
beforeAll(async () => {
  resource = await startTestDatabase();
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

async function input() {
  return {
    ticketId: await eligibleImplementationTicket(resource.database),
    expectedVersion: 1,
    requestKey: randomUUID(),
  };
}
function definition() {
  return {
    id: 456,
    path: ".github/workflows/resolva.yml",
    state: "active",
    url: "https://api.github.com/repos/equipe/alvo/actions/workflows/456",
  };
}

async function uncertain() {
  const request = await input();
  const github = createGithubClient({
    execute: async (args) => {
      if (args[0] === "workflow") throw new GithubCliError("timeout", "Tempo excedido");
      return { stdout: args[0] === "api" ? JSON.stringify(definition()) : "", stderr: "" };
    },
  });
  await expect(
    createImplementationService(repository, implementationEnvironment, github).start(request),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const list = await repository.list({ ticketId: request.ticketId, page: 1, pageSize: 15 });
  const executionId = list.items[0]?.execution.id;
  if (!executionId) throw new Error("Reserva ausente.");
  return { executionId, workflowId: "987654" };
}

function observer(
  executionId: string,
  overrides: Record<string, unknown> = {},
  beforeReturn?: () => Promise<void>,
) {
  const calls: string[][] = [];
  const github = createGithubClient({
    execute: async (args) => {
      calls.push([...args]);
      if (args[0] !== "api" || args[4] !== "GET")
        throw new Error("A reconciliação não pode escrever no GitHub.");
      await beforeReturn?.();
      return {
        stdout: JSON.stringify({
          ...githubWorkflowRun(),
          display_title: `Resolva ${executionId}`,
          created_at: new Date().toISOString(),
          status: "in_progress",
          conclusion: null,
          ...overrides,
        }),
        stderr: "",
      };
    },
  });
  return {
    service: createImplementationService(repository, implementationEnvironment, github),
    calls,
  };
}

async function completion(
  input: { executionId: string; workflowId: string },
  overrides: Record<string, unknown> = {},
  beforeBranch?: () => Promise<void>,
) {
  const detail = await repository.byId(input.executionId);
  if (!detail.delivery) throw new Error("Entrega ausente.");
  const delivery = detail.delivery;
  const github = createGithubClient({
    execute: async (args) => {
      const endpoint = args.at(-1) ?? "";
      let value: unknown;
      if (endpoint.includes("/actions/runs/"))
        value = {
          ...githubWorkflowRun(),
          display_title: `Resolva ${input.executionId}`,
          created_at: new Date().toISOString(),
          ...overrides,
        };
      else if (endpoint.includes("/pulls/")) {
        const pr = githubPullRequest();
        value = {
          ...pr,
          body: `<!-- resolva-delivery:${delivery.id} -->`,
          head: { ...pr.head, ref: delivery.branchName },
        };
      } else if (endpoint.includes("/git/ref/")) {
        await beforeBranch?.();
        value = { ...githubBranch(), ref: `refs/heads/${delivery.branchName}` };
      } else throw new Error("Consulta inesperada.");
      return { stdout: JSON.stringify(value), stderr: "" };
    },
  });
  const callback = {
    schemaVersion: 1 as const,
    ...input,
    repository: "equipe/alvo",
    workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    status: "success" as const,
    branch: delivery.branchName,
    commitSha: "a".repeat(40),
    pullRequest: {
      number: 12,
      url: "https://github.com/equipe/alvo/pull/12",
      state: "OPEN" as const,
    },
    failureReason: null,
  };
  return {
    service: createImplementationService(repository, implementationEnvironment, github),
    callback,
    delivery,
  };
}

describe("disparo incerto e recuperação", () => {
  it.each(["definição", "tentativa"])(
    "não aprova evidência divergente da %s já registrada no disparo",
    async (field) => {
      const request = await uncertain();
      await observer(request.executionId).service.reconcileDispatch(request);
      const detail = await repository.byId(request.executionId);
      if (!detail.delivery) throw new Error("Entrega ausente.");
      const evidence = {
        ...implementationEvidence(request.executionId, detail.delivery.id),
        ...(field === "definição" ? { workflowDefinitionId: "457" } : { workflowAttempt: 2 }),
      };
      await expect(repository.recordValidationEvidence(evidence)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect((await repository.byId(request.executionId)).execution.validatedSha).toBeNull();
    },
  );

  it.each([
    { display_title: "Resolva 11111111-1111-4111-8111-111111111111" },
    { created_at: "2020-01-01T00:00:00.000Z" },
  ])("não deixa conclusão comum contornar a correlação do checkpoint: %j", async (overrides) => {
    const request = await uncertain();
    await observer(request.executionId).service.reconcileDispatch(request);
    const { service, callback, delivery } = await completion(request, overrides);
    await repository.recordValidationEvidence(
      implementationEvidence(request.executionId, delivery.id),
    );
    await expect(service.applyCallback(callback)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).execution.status).toBe("em_andamento");
  });

  it("revalida o checkpoint após as consultas da confirmação comum", async () => {
    const request = await uncertain();
    await observer(request.executionId).service.reconcileDispatch(request);
    const { service, callback, delivery } = await completion(request, {}, async () => {
      await resource.database.pool.query(
        "UPDATE execution_events SET created_at=created_at+interval '1 second' WHERE execution_id=$1 AND type='workflow_dispatch_requested'",
        [request.executionId],
      );
    });
    await repository.recordValidationEvidence(
      implementationEvidence(request.executionId, delivery.id),
    );
    await expect(service.applyCallback(callback)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).delivery?.prNumber).toBeNull();
  });

  it("conclui pelo callback comum com evidência e run compatíveis com o checkpoint", async () => {
    const request = await uncertain();
    await observer(request.executionId).service.reconcileDispatch(request);
    const { service, callback, delivery } = await completion(request);
    await repository.recordValidationEvidence(
      implementationEvidence(request.executionId, delivery.id),
    );
    await expect(service.applyCallback(callback)).resolves.toMatchObject({ applied: true });
    expect((await repository.byId(request.executionId)).ticket.status).toBe("aguardando_revisao");
  });
  it("mantém exclusividade depois de timeout e não dispara outra vez no replay", async () => {
    const request = await input();
    let dispatches = 0;
    const github = createGithubClient({
      execute: async (args) => {
        if (args[0] === "workflow") {
          dispatches++;
          throw new GithubCliError("timeout", "segredo-ficticio");
        }
        return { stdout: args[0] === "api" ? JSON.stringify(definition()) : "", stderr: "" };
      },
    });
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.start(request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const list = await repository.list({ page: 1, pageSize: 15, ticketId: request.ticketId });
    const execution = list.items[0]?.execution;
    expect(execution).toMatchObject({
      status: "em_andamento",
      outcome: "workflow_dispatch_unconfirmed",
    });
    if (!execution) throw new Error("Reserva ausente.");
    expect((await repository.byId(execution.id)).ticket.status).toBe("em_andamento");
    await expect(service.start(request)).resolves.toEqual({
      implementationExecutionId: execution.id,
    });
    expect(dispatches).toBe(1);
    const other = await input();
    await expect(repository.reserve(other, implementationEnvironment)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const events = await resource.database.pool.query(
      "SELECT type,message,payload FROM execution_events WHERE execution_id=$1 ORDER BY sequence",
      [execution.id],
    );
    expect(events.rows.map((row) => row.type)).toEqual([
      "started",
      "workflow_dispatch_requested",
      "workflow_dispatch_unconfirmed",
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("segredo-ficticio");
  });

  it("grava o checkpoint antes de chamar o processo externo", async () => {
    const request = await input();
    let checkpointSeen = false;
    const github = createGithubClient({
      execute: async (args) => {
        if (args[0] === "workflow") {
          const executionId = args
            .find((arg) => arg.startsWith("executionId="))
            ?.slice("executionId=".length);
          const rows = await resource.database.pool.query(
            "SELECT id FROM execution_events WHERE execution_id=$1 AND type='workflow_dispatch_requested'",
            [executionId],
          );
          checkpointSeen = rows.rowCount === 1;
        }
        return { stdout: args[0] === "api" ? JSON.stringify(definition()) : "", stderr: "" };
      },
    });
    await createImplementationService(repository, implementationEnvironment, github).start(request);
    expect(checkpointSeen).toBe(true);
  });

  it("não libera uma execução com checkpoint mesmo se o bloqueio for chamado diretamente", async () => {
    const request = await input();
    const { id } = await repository.reserve(request, implementationEnvironment);
    await repository.beginWorkflowDispatch(id, {
      id: "456",
      path: ".github/workflows/resolva.yml",
    });
    await repository.blockWorkflowDispatch(id);
    expect((await repository.byId(id)).execution.status).toBe("em_andamento");
  });

  it.each([
    ["queued", null, "queued", "em_andamento", "pipeline_queued", "em_andamento"],
    ["in_progress", null, "running", "em_andamento", "pipeline_running", "em_andamento"],
    ["completed", "success", "success", "em_andamento", "pipeline_awaiting_report", "em_andamento"],
    ["completed", "failure", "failure", "falhou", "pipeline_failure", "aberto"],
    ["completed", "cancelled", "cancelled", "interrompida", "pipeline_cancelled", "aberto"],
    [
      "completed",
      "action_required",
      "indeterminate",
      "em_andamento",
      "pipeline_awaiting_report",
      "em_andamento",
    ],
  ])(
    "reconcilia run %s/%s sem repetir o envio",
    async (status, conclusion, observedStatus, executionStatus, outcome, ticketStatus) => {
      const request = await uncertain();
      const { service, calls } = observer(request.executionId, { status, conclusion });
      await expect(service.reconcileDispatch(request)).resolves.toMatchObject({
        applied: true,
        workflowId: "987654",
        observedStatus,
      });
      const detail = await repository.byId(request.executionId);
      expect(detail.execution).toMatchObject({
        workflowId: "987654",
        workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
        status: executionStatus,
        outcome,
      });
      expect(detail.ticket.status).toBe(ticketStatus);
      expect(detail.delivery?.prNumber).toBeNull();
      expect(detail.execution.validatedSha).toBeNull();
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    ["outro ticket", { display_title: "Resolva 11111111-1111-4111-8111-111111111111" }],
    ["outra definição", { workflow_id: 457 }],
    ["outra branch", { head_branch: "release" }],
    ["outro evento", { event: "push" }],
    ["run anterior ao checkpoint", { created_at: "2020-01-01T00:00:00.000Z" }],
  ])("não associa workflow de %s", async (_name, overrides) => {
    const request = await uncertain();
    const { service } = observer(request.executionId, overrides);
    await expect(service.reconcileDispatch(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).execution).toMatchObject({
      workflowId: null,
      status: "em_andamento",
    });
  });

  it("conserva exclusividade quando o GitHub está indisponível", async () => {
    const request = await uncertain();
    const github = createGithubClient({
      execute: async () => {
        throw new GithubCliError("failed", "segredo-remoto");
      },
    });
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.reconcileDispatch(request)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect((await repository.byId(request.executionId)).execution).toMatchObject({
      workflowId: null,
      status: "em_andamento",
    });
  });

  it("recusa observação se o checkpoint mudar durante a consulta sem lock externo", async () => {
    const request = await uncertain();
    const { service } = observer(request.executionId, {}, async () => {
      const client = await resource.database.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='2s'");
        await client.query(
          "UPDATE execution_events SET payload=jsonb_set(payload,'{workflowDefinitionId}','\"457\"') WHERE execution_id=$1 AND type='workflow_dispatch_requested'",
          [request.executionId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
    await expect(service.reconcileDispatch(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).execution.workflowId).toBeNull();
  });

  it("serializa reconciliações concorrentes e não duplica histórico", async () => {
    const request = await uncertain();
    const { service } = observer(request.executionId, { created_at: new Date().toISOString() });
    const results = await Promise.all([
      service.reconcileDispatch(request),
      service.reconcileDispatch(request),
    ]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM execution_events WHERE execution_id=$1 AND type='workflow_dispatch_reconciled'",
          [request.executionId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("repete término remoto confirmado mesmo offline", async () => {
    const request = await uncertain();
    const { service } = observer(request.executionId, {
      status: "completed",
      conclusion: "failure",
    });
    await service.reconcileDispatch(request);
    const github = createGithubClient({
      execute: async () => {
        throw new Error("Não deveria consultar.");
      },
    });
    const offline = createImplementationService(repository, implementationEnvironment, github);
    await expect(offline.reconcileDispatch(request)).resolves.toMatchObject({
      applied: false,
      observedStatus: "failure",
    });
  });

  it("não troca de run nem de tentativa nem regride para queued", async () => {
    const request = await uncertain();
    await observer(request.executionId).service.reconcileDispatch(request);
    const second = observer(request.executionId);
    await expect(
      second.service.reconcileDispatch({ ...request, workflowId: "987655" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(second.calls).toEqual([]);
    await expect(
      observer(request.executionId, { run_attempt: 2 }).service.reconcileDispatch(request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      observer(request.executionId, { status: "queued" }).service.reconcileDispatch(request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("não libera um sucesso remoto aguardando relatório por callback terminal divergente", async () => {
    const request = await uncertain();
    await observer(request.executionId, {
      status: "completed",
      conclusion: "success",
    }).service.reconcileDispatch(request);
    await expect(
      repository.applyPipelineCallback({
        schemaVersion: 1,
        ...request,
        repository: "equipe/alvo",
        workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
        status: "failure",
        failureReason: "Falha divergente",
        branch: null,
        commitSha: null,
        pullRequest: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).execution.status).toBe("em_andamento");
  });

  it("expõe reconciliação por HTTP com validação do ID", async () => {
    const request = await uncertain();
    const { service, calls } = observer(request.executionId);
    const server = createServer({ implementationService: service });
    try {
      const invalid = await server.inject({
        method: "POST",
        url: "/trpc/implementations.reconcileDispatch",
        headers: { host: "127.0.0.1:3000" },
        payload: { ...request, workflowId: "../12" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(calls).toEqual([]);
      const response = await server.inject({
        method: "POST",
        url: "/trpc/implementations.reconcileDispatch",
        headers: { host: "127.0.0.1:3000" },
        payload: request,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.data).toMatchObject({
        applied: true,
        workflowId: "987654",
        observedStatus: "running",
      });
    } finally {
      await server.close();
    }
  });

  it("não repete envio depois de queda entre checkpoint e chamada externa", async () => {
    const request = await input();
    const { id } = await repository.reserve(request, implementationEnvironment);
    await repository.beginWorkflowDispatch(id, {
      id: "456",
      path: ".github/workflows/resolva.yml",
    });
    let calls = 0;
    const github = createGithubClient({
      execute: async () => {
        calls++;
        throw new Error("Envio repetido.");
      },
    });
    await expect(
      createImplementationService(repository, implementationEnvironment, github).start(request),
    ).resolves.toEqual({ implementationExecutionId: id });
    expect(calls).toBe(0);
    expect((await repository.byId(id)).execution.status).toBe("em_andamento");
  });

  it("preserva callback recebido antes da resposta perdida do disparo", async () => {
    const request = await input();
    const github = createGithubClient({
      execute: async (args) => {
        if (args[0] === "workflow") {
          const executionId = args
            .find((arg) => arg.startsWith("executionId="))
            ?.slice("executionId=".length);
          if (!executionId) throw new Error("Execução ausente.");
          await repository.applyPipelineCallback({
            schemaVersion: 1,
            executionId,
            repository: "equipe/alvo",
            workflowId: "987654",
            workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
            status: "running",
            branch: null,
            commitSha: null,
            pullRequest: null,
            failureReason: null,
          });
          throw new GithubCliError("timeout", "Resposta perdida.");
        }
        return { stdout: args[0] === "api" ? JSON.stringify(definition()) : "", stderr: "" };
      },
    });
    const result = await createImplementationService(
      repository,
      implementationEnvironment,
      github,
    ).start(request);
    expect((await repository.byId(result.implementationExecutionId)).execution).toMatchObject({
      status: "em_andamento",
      workflowId: "987654",
      outcome: "pipeline_running",
    });
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM execution_events WHERE execution_id=$1 AND type='workflow_dispatch_unconfirmed'",
          [result.implementationExecutionId],
        )
      ).rowCount,
    ).toBe(0);
  });

  it.each(["workflow_dispatch_requested", "workflow_dispatched"])(
    "trata falha ao persistir %s no lado correto do envio",
    async (type) => {
      const request = await input();
      let dispatches = 0;
      const github = createGithubClient({
        execute: async (args) => {
          if (args[0] === "workflow") dispatches++;
          return { stdout: args[0] === "api" ? JSON.stringify(definition()) : "", stderr: "" };
        },
      });
      await resource.database.pool.query(
        `ALTER TABLE execution_events ADD CONSTRAINT reject_dispatch_test CHECK (type <> '${type}')`,
      );
      try {
        await expect(
          createImplementationService(repository, implementationEnvironment, github).start(request),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      } finally {
        await resource.database.pool.query(
          "ALTER TABLE execution_events DROP CONSTRAINT reject_dispatch_test",
        );
      }
      const list = await repository.list({ page: 1, pageSize: 15, ticketId: request.ticketId });
      expect(dispatches).toBe(type === "workflow_dispatch_requested" ? 0 : 1);
      expect(list.items[0]?.execution.status).toBe(
        type === "workflow_dispatch_requested" ? "bloqueada" : "em_andamento",
      );
    },
  );

  it("recusa reconciliação sem checkpoint antes de consultar GitHub", async () => {
    const { id } = await repository.reserve(await input(), implementationEnvironment);
    const { service, calls } = observer(id);
    await expect(
      service.reconcileDispatch({ executionId: id, workflowId: "987654" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(calls).toEqual([]);
  });

  it("não sobrepõe proposta de sucesso que chegou durante a consulta de falha remota", async () => {
    const request = await uncertain();
    const detail = await repository.byId(request.executionId);
    const { service } = observer(
      request.executionId,
      { status: "completed", conclusion: "failure" },
      async () => {
        await repository.registerSuccessProposal({
          schemaVersion: 1,
          ...request,
          repository: "equipe/alvo",
          workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
          status: "success",
          branch: detail.delivery?.branchName ?? "",
          commitSha: "a".repeat(40),
          pullRequest: { number: 12, url: "https://github.com/equipe/alvo/pull/12", state: "OPEN" },
          failureReason: null,
        });
      },
    );
    await expect(service.reconcileDispatch(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(request.executionId)).execution).toMatchObject({
      status: "em_andamento",
      outcome: "pipeline_awaiting_confirmation",
    });
  });
});
