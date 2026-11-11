import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../test/database.js";
import {
  eligibleImplementationTicket,
  implementationEnvironment,
  implementationEvidence,
} from "../test/implementation.js";
import { createImplementationRepository } from "./implementationRepository.js";
import type { PipelineCallback } from "../integrations/ci/callback.js";
import { createGithubClient, GithubCliError } from "../integrations/github/cli.js";
import { createImplementationService } from "../services/implementationService.js";
import { githubBranch, githubPullRequest, githubWorkflowRun } from "../test/github.js";
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

async function reservation(classification = "bug") {
  const ticketId = await eligibleImplementationTicket(resource.database, classification);
  const { id } = await repository.reserve(
    { ticketId, expectedVersion: 1, requestKey: randomUUID() },
    implementationEnvironment,
  );
  const detail = await repository.byId(id);
  if (!detail.delivery) throw new Error("Entrega da reserva ausente.");
  return { id, ticketId, deliveryId: detail.delivery.id, branch: detail.delivery.branchName };
}

function callback(
  executionId: string,
  overrides: Partial<PipelineCallback> = {},
): PipelineCallback {
  return {
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
    ...overrides,
  };
}

type Reservation = Awaited<ReturnType<typeof reservation>>;
function success(reserved: Reservation) {
  return callback(reserved.id, {
    status: "success",
    branch: reserved.branch,
    commitSha: "a".repeat(40),
    pullRequest: { number: 12, url: "https://github.com/equipe/alvo/pull/12", state: "OPEN" },
  });
}
function remote(
  reserved: Reservation,
  options: {
    run?: Record<string, unknown>;
    pr?: Record<string, unknown>;
    branchSha?: string;
    beforeBranch?: () => Promise<void>;
  } = {},
) {
  const calls: string[][] = [];
  const github = createGithubClient({
    execute: async (args) => {
      calls.push([...args]);
      const endpoint = args.at(-1) ?? "";
      let value: unknown;
      if (endpoint.endsWith("/actions/runs/987654"))
        value = { ...githubWorkflowRun(), ...options.run };
      else if (endpoint.endsWith("/pulls/12")) {
        const pr = githubPullRequest();
        value = {
          ...pr,
          head: { ...pr.head, ref: reserved.branch },
          body: `<!-- resolva-delivery:${reserved.deliveryId} -->`,
          ...options.pr,
        };
      } else if (endpoint.includes("/git/ref/heads/")) {
        await options.beforeBranch?.();
        value = {
          ...githubBranch(),
          ref: `refs/heads/${reserved.branch}`,
          object: { type: "commit", sha: options.branchSha ?? "a".repeat(40) },
        };
      } else throw new Error("Operação GitHub inesperada.");
      return { stdout: JSON.stringify(value), stderr: "" };
    },
  });
  return { github, calls };
}
async function approve(reserved: Reservation) {
  await repository.applyPipelineCallback(callback(reserved.id));
  return repository.recordValidationEvidence(
    implementationEvidence(reserved.id, reserved.deliveryId),
  );
}

describe("evidências e conclusão da implementação", () => {
  it("recusa conclusão direta sem evidência e confirmação remota", async () => {
    const reserved = await reservation();
    await expect(repository.applyPipelineCallback(success(reserved))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect((await repository.byId(reserved.id)).execution.status).toBe("em_andamento");
  });

  it("persiste proposta sem concluir quando falta evidência e não consulta GitHub", async () => {
    const reserved = await reservation();
    const { github, calls } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(calls).toEqual([]);
    const detail = await repository.byId(reserved.id);
    expect(detail.execution).toMatchObject({
      status: "em_andamento",
      outcome: "pipeline_awaiting_confirmation",
    });
    expect(detail.ticket.status).toBe("em_andamento");
    expect(detail.delivery?.prNumber).toBeNull();
  });

  it("confirma evidência, workflow, PR e branch e conclui atomicamente uma única vez", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const { github, calls } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    const results = await Promise.all([
      service.applyCallback(success(reserved)),
      service.applyCallback(success(reserved)),
    ]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    const detail = await repository.byId(reserved.id);
    expect(detail.execution).toMatchObject({ status: "concluida", validatedSha: "a".repeat(40) });
    expect(detail.ticket.status).toBe("aguardando_revisao");
    expect(detail.delivery).toMatchObject({
      prNumber: 12,
      prUrl: "https://github.com/equipe/alvo/pull/12",
      prState: "OPEN",
      remoteHeadSha: "a".repeat(40),
    });
    expect(calls.every((args) => args[0] === "api" && args[4] === "GET")).toBe(true);
    const history = await resource.database.pool.query(
      "SELECT id FROM ticket_events WHERE ticket_id=$1 AND type='implementation_ready_for_review'",
      [reserved.ticketId],
    );
    expect(history.rowCount).toBe(1);
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM execution_events WHERE execution_id=$1 AND type='pipeline_success_reported'",
          [reserved.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it.each([
    ["tentativa da workflow", { run: { run_attempt: 2 } }],
    ["definição da workflow", { run: { workflow_id: 457 } }],
    ["workflow em andamento", { run: { status: "in_progress", conclusion: null } }],
    ["workflow falhou", { run: { conclusion: "failure" } }],
    ["branch base da workflow", { run: { head_branch: "release" } }],
    ["SHA remoto", { branchSha: "b".repeat(40) }],
    ["marcador da PR", { pr: { body: "Outra entrega" } }],
    ["PR fechada", { pr: { state: "closed", merged: false } }],
  ])("mantém a execução ativa quando diverge %s", async (_name, options) => {
    const reserved = await reservation();
    await approve(reserved);
    const { github } = remote(reserved, options);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const detail = await repository.byId(reserved.id);
    expect(detail.execution.status).toBe("em_andamento");
    expect(detail.ticket.status).toBe("em_andamento");
    expect(detail.delivery?.prNumber).toBeNull();
  });

  it.each(["failure", "cancelled"] as const)(
    "não libera exclusividade com callback %s após sucesso ainda não confirmado",
    async (status) => {
      const reserved = await reservation();
      await approve(reserved);
      const { github } = remote(reserved, { run: { status: "in_progress", conclusion: null } });
      const service = createImplementationService(repository, implementationEnvironment, github);
      await expect(service.applyCallback(success(reserved))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        service.applyCallback(
          callback(reserved.id, { status, failureReason: "Término divergente" }),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const detail = await repository.byId(reserved.id);
      expect(detail.execution).toMatchObject({
        status: "em_andamento",
        outcome: "pipeline_awaiting_confirmation",
      });
      expect(detail.ticket.status).toBe("em_andamento");
      await expect(repository.applyPipelineCallback(callback(reserved.id))).resolves.toMatchObject({
        applied: false,
      });
    },
  );

  it("recusa prova que ficou desatualizada durante a consulta remota", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const { github } = remote(reserved, {
      beforeBranch: async () => {
        const client = await resource.database.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL lock_timeout = '2s'");
          await client.query("UPDATE executions SET validated_sha=$1 WHERE id=$2", [
            "b".repeat(40),
            reserved.id,
          ]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    });
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await repository.byId(reserved.id)).execution.status).toBe("em_andamento");
  });

  it("faz rollback da PR e dos estados se a gravação do callback final falha", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const { github, calls } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await resource.database.pool.query(
      "ALTER TABLE execution_events ADD CONSTRAINT reject_completion_test CHECK (type <> 'pipeline_callback' OR payload->>'status' <> 'success')",
    );
    try {
      await expect(service.applyCallback(success(reserved))).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE execution_events DROP CONSTRAINT reject_completion_test",
      );
    }
    expect(calls).toHaveLength(3);
    const detail = await repository.byId(reserved.id);
    expect(detail.delivery?.prNumber).toBeNull();
    expect(detail.ticket.status).toBe("em_andamento");
    expect(detail.execution).toMatchObject({ status: "em_andamento", completedAt: null });
  });

  it("reconcilia manualmente por HTTP depois de indisponibilidade e ignora replay offline", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const unavailable = createGithubClient({
      execute: async () => {
        throw new GithubCliError("timeout", "segredo-ficticio");
      },
    });
    const failedService = createImplementationService(
      repository,
      implementationEnvironment,
      unavailable,
    );
    await expect(failedService.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    const { github, calls } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    const server = createServer({ implementationService: service });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/trpc/implementations.reconcile",
        headers: { host: "127.0.0.1:3000" },
        payload: { executionId: reserved.id },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.data.applied).toBe(true);
      expect(calls).toHaveLength(3);
      const offline = createImplementationService(
        repository,
        implementationEnvironment,
        unavailable,
      );
      await expect(offline.reconcile(reserved.id)).resolves.toMatchObject({ applied: false });
      expect(JSON.stringify(response.json())).not.toContain("segredo-ficticio");
    } finally {
      await server.close();
    }
  });

  it("recusa reconciliação sem proposta suficiente sem consultar ou disparar", async () => {
    const reserved = await reservation();
    const { github, calls } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.reconcile(reserved.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(calls).toEqual([]);
  });

  it("não permite aprovar evidências pelo callback HTTP e devolve erro remoto sanitizado", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const unavailable = createGithubClient({
      execute: async () => {
        throw new GithubCliError("failed", "token-ficticio-nao-expor");
      },
    });
    const service = createImplementationService(repository, implementationEnvironment, unavailable);
    const server = createServer({ implementationService: service });
    try {
      const forged = await server.inject({
        method: "POST",
        url: "/trpc/implementations.callback",
        headers: { host: "127.0.0.1:3000" },
        payload: {
          ...success(reserved),
          evidence: implementationEvidence(reserved.id, reserved.deliveryId),
        },
      });
      expect(forged.statusCode).toBe(400);
      const failed = await server.inject({
        method: "POST",
        url: "/trpc/implementations.callback",
        headers: { host: "127.0.0.1:3000" },
        payload: success(reserved),
      });
      expect(failed.statusCode).toBe(412);
      expect(failed.json().error.data.code).toBe("PRECONDITION_FAILED");
      expect(failed.body).not.toContain("token-ficticio-nao-expor");
      const hidden = await server.inject({
        method: "POST",
        url: "/trpc/implementations.recordValidationEvidence",
        headers: { host: "127.0.0.1:3000" },
        payload: implementationEvidence(reserved.id, reserved.deliveryId),
      });
      expect(hidden.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("reconcilia a proposta compatível com a evidência e preserva replay da conclusão", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const offline = createImplementationService(repository, implementationEnvironment);
    await expect(offline.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      offline.applyCallback({ ...success(reserved), commitSha: "b".repeat(40) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const { github } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await expect(service.reconcile(reserved.id)).resolves.toMatchObject({ applied: true });
    await expect(offline.reconcile(reserved.id)).resolves.toMatchObject({ applied: false });
  });

  it("conserva a proposta concluída quando outra proposta antiga tinha número de PR divergente", async () => {
    const reserved = await reservation();
    await approve(reserved);
    const offline = createImplementationService(repository, implementationEnvironment);
    await expect(offline.applyCallback(success(reserved))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      offline.applyCallback({
        ...success(reserved),
        pullRequest: { number: 13, url: "https://github.com/equipe/alvo/pull/13", state: "OPEN" },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const { github } = remote(reserved);
    const service = createImplementationService(repository, implementationEnvironment, github);
    await service.applyCallback(success(reserved));
    await expect(offline.reconcile(reserved.id)).resolves.toMatchObject({ applied: false });
  });

  it("serializa aprovações concorrentes sem duplicar relatórios", async () => {
    const reserved = await reservation();
    await repository.applyPipelineCallback(callback(reserved.id));
    const evidence = implementationEvidence(reserved.id, reserved.deliveryId);
    const results = await Promise.all([
      repository.recordValidationEvidence(evidence),
      repository.recordValidationEvidence(evidence),
    ]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(
      (
        await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [
          reserved.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("aprova melhoria com teste do comportamento novo sem exigir falha de bug", async () => {
    const reserved = await reservation("melhoria");
    await repository.applyPipelineCallback(callback(reserved.id));
    const evidence = {
      ...implementationEvidence(reserved.id, reserved.deliveryId),
      classification: "melhoria",
      regression: { status: "passed", total: 1, passed: 1, failed: 0 },
    };
    await expect(repository.recordValidationEvidence(evidence)).resolves.toMatchObject({
      applied: true,
    });
  });
  it("persiste SHA, evidência imutável e metadados atomicamente e sem duplicação", async () => {
    const { id, deliveryId } = await reservation();
    await repository.applyPipelineCallback(callback(id));
    const evidence = implementationEvidence(id, deliveryId);
    await expect(repository.recordValidationEvidence(evidence)).resolves.toMatchObject({
      applied: true,
    });
    await expect(repository.recordValidationEvidence(evidence)).resolves.toMatchObject({
      applied: false,
    });
    expect((await repository.byId(id)).execution.validatedSha).toBe("a".repeat(40));
    const artifacts = await resource.database.pool.query(
      "SELECT kind,relative_path,sha256,size_bytes FROM artifacts WHERE execution_id=$1",
      [id],
    );
    expect(artifacts.rows).toEqual([
      {
        kind: "validation_report",
        relative_path: "validation.json",
        sha256: "d".repeat(64),
        size_bytes: 512,
      },
    ]);
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM execution_events WHERE execution_id=$1 AND type='validation_approved'",
          [id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it.each([
    ["sem baseline", { baseline: { status: "zero_tests", total: 0, passed: 0, failed: 0 } }],
    [
      "sem falha de asserção",
      { regression: { status: "runner_failed", total: 1, passed: 0, failed: 1 } },
    ],
    ["regressão já verde", { regression: { status: "passed", total: 1, passed: 1, failed: 0 } }],
    ["validação final incompleta", { final: { status: "passed", total: 3, passed: 2, failed: 0 } }],
    ["sem teste novo", { final: { status: "passed", total: 2, passed: 2, failed: 0 } }],
    [
      "teste modificado",
      {
        test: {
          path: "tests/total.test.ts",
          frozenSha256: "c".repeat(64),
          finalSha256: "e".repeat(64),
        },
      },
    ],
    [
      "teste fora do manifesto",
      { test: { path: "src/total.ts", frozenSha256: "c".repeat(64), finalSha256: "c".repeat(64) } },
    ],
    [
      "artefato fora da raiz",
      { report: { relativePath: "../validation.json", sha256: "d".repeat(64), sizeBytes: 512 } },
    ],
    ["outro workflow", { workflowId: "987655" }],
    ["outra entrega", { deliveryId: "22222222-2222-4222-8222-222222222222" }],
    [
      "outra classificação",
      {
        classification: "melhoria",
        regression: { status: "passed", total: 1, passed: 1, failed: 0 },
      },
    ],
  ])("recusa evidência %s sem persistir aprovação", async (_name, overrides) => {
    const { id, deliveryId } = await reservation();
    await repository.applyPipelineCallback(callback(id));
    await expect(
      repository.recordValidationEvidence({
        ...implementationEvidence(id, deliveryId),
        ...overrides,
      }),
    ).rejects.toThrow();
    expect((await repository.byId(id)).execution.validatedSha).toBeNull();
    expect(
      (await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [id]))
        .rowCount,
    ).toBe(0);
  });

  it("recusa substituir uma aprovação por outro SHA", async () => {
    const { id, deliveryId } = await reservation();
    await repository.applyPipelineCallback(callback(id));
    const evidence = implementationEvidence(id, deliveryId);
    await repository.recordValidationEvidence(evidence);
    await expect(
      repository.recordValidationEvidence({ ...evidence, commitSha: "b".repeat(40) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(id)).execution.validatedSha).toBe("a".repeat(40));
  });

  it("faz rollback do SHA e artefato se o evento de aprovação falha", async () => {
    const { id, deliveryId } = await reservation();
    await repository.applyPipelineCallback(callback(id));
    await resource.database.pool.query(
      "ALTER TABLE execution_events ADD CONSTRAINT reject_approval_test CHECK (type <> 'validation_approved')",
    );
    try {
      await expect(
        repository.recordValidationEvidence(implementationEvidence(id, deliveryId)),
      ).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE execution_events DROP CONSTRAINT reject_approval_test",
      );
    }
    expect((await repository.byId(id)).execution.validatedSha).toBeNull();
    expect(
      (await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [id]))
        .rowCount,
    ).toBe(0);
  });
});
