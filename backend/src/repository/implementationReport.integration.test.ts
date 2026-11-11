import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../test/database.js";
import { eligibleImplementationTicket, implementationEnvironment } from "../test/implementation.js";
import { createImplementationRepository } from "./implementationRepository.js";
import { createImplementationService } from "../services/implementationService.js";
import { createPipelineReportCollector } from "../integrations/ci/collectReport.js";
import { createGithubClient, GithubCliError } from "../integrations/github/cli.js";
import { githubBranch, githubPullRequest, githubWorkflowRun } from "../test/github.js";
import { pipelineReport, pipelineReportContext } from "../test/pipelineReport.js";
import { reportZip } from "../test/archive.js";
import { createServer } from "../server.js";

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
let repository: ReturnType<typeof createImplementationRepository>;
const roots: string[] = [];
beforeAll(async () => {
  resource = await startTestDatabase();
  repository = createImplementationRepository(resource.database);
});
afterAll(async () => {
  await resource?.stop();
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});

async function fixture(
  options: {
    edit?: (value: ReturnType<typeof pipelineReport>) => void;
    noArtifact?: boolean;
    run?: Record<string, unknown>;
    beforeDownload?: (executionId: string) => Promise<void>;
    badRoot?: boolean;
  } = {},
) {
  const ticketId = await eligibleImplementationTicket(resource.database);
  const { id } = await repository.reserve(
    { ticketId, expectedVersion: 1, requestKey: randomUUID() },
    implementationEnvironment,
  );
  await repository.beginWorkflowDispatch(id, { id: "456", path: ".github/workflows/resolva.yml" });
  await repository.applyPipelineCallback({
    schemaVersion: 1,
    executionId: id,
    repository: "equipe/alvo",
    workflowId: "987654",
    workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    status: "running",
    branch: null,
    commitSha: null,
    pullRequest: null,
    failureReason: null,
  });
  const detail = await repository.byId(id);
  if (!detail.delivery || !detail.execution.triageId) throw new Error("Reserva incompleta.");
  const delivery = detail.delivery;
  const value = pipelineReport({
    ...pipelineReportContext,
    executionId: id,
    deliveryId: delivery.id,
    ticketId,
    triageId: detail.execution.triageId,
    branchName: delivery.branchName,
  });
  options.edit?.(value);
  const archive = await reportZip([
    { name: "report.json", content: Buffer.from(JSON.stringify(value)) },
  ]);
  const applicationRoot = await mkdtemp(join(tmpdir(), "resolva-collection-"));
  roots.push(applicationRoot);
  if (options.badRoot) await writeFile(join(applicationRoot, ".resolva"), "não é diretório");
  let artifactsAvailable = true;
  let githubAvailable = true;
  const calls: string[][] = [];
  const github = createGithubClient({
    execute: async (args) => {
      calls.push([...args]);
      if (!githubAvailable) throw new GithubCliError("failed", "token-ficticio");
      const endpoint = args.at(-1) ?? "";
      let response: unknown;
      if (endpoint.includes("/artifacts?")) {
        if (!artifactsAvailable) throw new GithubCliError("failed", "Artefato expirou");
        response = options.noArtifact
          ? { total_count: 0, artifacts: [] }
          : {
              total_count: 1,
              artifacts: [
                {
                  id: 11,
                  name: `resolva-report-${id}-1`,
                  expired: false,
                  size_in_bytes: archive.length,
                  digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
                  workflow_run: { id: 987654 },
                },
              ],
            };
      } else if (endpoint.includes("/actions/runs/"))
        response = {
          ...githubWorkflowRun(),
          display_title: `Resolva ${id}`,
          created_at: new Date().toISOString(),
          ...options.run,
        };
      else if (endpoint.includes("/pulls/")) {
        const pr = githubPullRequest();
        response = {
          ...pr,
          body: `<!-- resolva-delivery:${delivery.id} -->`,
          head: { ...pr.head, ref: delivery.branchName },
        };
      } else if (endpoint.includes("/git/ref/"))
        response = { ...githubBranch(), ref: `refs/heads/${delivery.branchName}` };
      else throw new Error("Operação inesperada.");
      return { stdout: JSON.stringify(response), stderr: "" };
    },
    executeBinary: async (args) => {
      calls.push([...args]);
      if (!artifactsAvailable) throw new GithubCliError("failed", "Artefato expirou");
      await options.beforeDownload?.(id);
      return { stdout: archive, stderr: "" };
    },
  });
  const collector = createPipelineReportCollector({
    applicationRoot,
    secretValues: ["token-ficticio"],
  });
  return {
    id,
    applicationRoot,
    calls,
    service: createImplementationService(repository, implementationEnvironment, github, collector),
    expire: () => {
      artifactsAvailable = false;
    },
    offline: () => {
      githubAvailable = false;
    },
  };
}

describe("coleta de relatório e conclusão", () => {
  it("coleta relatório autenticado, sanitiza, aprova e conclui por HTTP", async () => {
    const test = await fixture({
      edit: (value) => {
        value.runReport.diagnosis = "Diagnóstico token-ficticio";
      },
    });
    const server = createServer({ implementationService: test.service });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/trpc/implementations.collectReport",
        headers: { host: "127.0.0.1:3000" },
        payload: { executionId: test.id },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.data.applied).toBe(true);
    } finally {
      await server.close();
    }
    const detail = await repository.byId(test.id);
    expect(detail.execution).toMatchObject({ status: "concluida", validatedSha: "a".repeat(40) });
    expect(detail.ticket.status).toBe("aguardando_revisao");
    const artifacts = await resource.database.pool.query(
      "SELECT relative_path,sha256 FROM artifacts WHERE execution_id=$1",
      [test.id],
    );
    expect(artifacts.rowCount).toBe(1);
    const content = await readFile(
      join(test.applicationRoot, ".resolva/artifacts", artifacts.rows[0].relative_path),
    );
    expect(content.toString()).not.toContain("token-ficticio");
    expect(content.toString()).toContain("[REDACTED]");
    expect(createHash("sha256").update(content).digest("hex")).toBe(artifacts.rows[0].sha256);
    expect(test.calls.every((args) => args[0] === "api" && args[4] === "GET")).toBe(true);
    test.offline();
    await expect(test.service.collectReport(test.id)).resolves.toMatchObject({ applied: false });
  });

  it.each(["noArtifact", "invalidReport", "badRoot", "running"])(
    "mantém execução ativa se falha %s",
    async (reason) => {
      const test = await fixture({
        noArtifact: reason === "noArtifact",
        badRoot: reason === "badRoot",
        ...(reason === "invalidReport"
          ? {
              edit: (value: ReturnType<typeof pipelineReport>) => {
                value.validation.final.report.numPassedTests = 999;
              },
            }
          : {}),
        ...(reason === "running" ? { run: { status: "in_progress", conclusion: null } } : {}),
      });
      await expect(test.service.collectReport(test.id)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect((await repository.byId(test.id)).execution).toMatchObject({
        status: "em_andamento",
        validatedSha: null,
      });
      expect(
        (
          await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [
            test.id,
          ])
        ).rowCount,
      ).toBe(0);
    },
  );

  it("recusa contexto alterado durante download sem aprovar evidência", async () => {
    const test = await fixture({
      beforeDownload: async (id) => {
        await resource.database.pool.query(
          "UPDATE execution_events SET payload=jsonb_set(payload,'{workflowDefinitionId}','\"457\"') WHERE execution_id=$1 AND type='workflow_dispatch_requested'",
          [id],
        );
      },
    });
    await expect(test.service.collectReport(test.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.byId(test.id)).execution.validatedSha).toBeNull();
    expect(
      (
        await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [
          test.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("reutiliza cópia local aprovada se a proposta falhou e o artefato remoto expirou", async () => {
    const test = await fixture();
    await resource.database.pool.query(
      "ALTER TABLE execution_events ADD CONSTRAINT reject_collected_proposal_test CHECK (type <> 'pipeline_success_reported')",
    );
    try {
      await expect(test.service.collectReport(test.id)).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE execution_events DROP CONSTRAINT reject_collected_proposal_test",
      );
    }
    expect((await repository.byId(test.id)).execution.validatedSha).toBe("a".repeat(40));
    const previousDownloads = test.calls.filter((args) => args.at(-1)?.endsWith("/zip")).length;
    test.expire();
    await expect(test.service.collectReport(test.id)).resolves.toMatchObject({ applied: true });
    expect(test.calls.filter((args) => args.at(-1)?.endsWith("/zip"))).toHaveLength(
      previousDownloads,
    );
  });

  it("recusa cópia local aprovada que foi alterada", async () => {
    const test = await fixture();
    await resource.database.pool.query(
      "ALTER TABLE execution_events ADD CONSTRAINT reject_collected_proposal_test CHECK (type <> 'pipeline_success_reported')",
    );
    try {
      await expect(test.service.collectReport(test.id)).rejects.toThrow();
    } finally {
      await resource.database.pool.query(
        "ALTER TABLE execution_events DROP CONSTRAINT reject_collected_proposal_test",
      );
    }
    const files = await readdir(join(test.applicationRoot, ".resolva/artifacts", test.id));
    await writeFile(
      join(test.applicationRoot, ".resolva/artifacts", test.id, files[0]!),
      "alterado",
    );
    await expect(test.service.collectReport(test.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect((await repository.byId(test.id)).execution.status).toBe("em_andamento");
  });

  it("serializa aprovação/conclusão concorrentes sem duplicar artefatos", async () => {
    const test = await fixture();
    const results = await Promise.all([
      test.service.collectReport(test.id),
      test.service.collectReport(test.id),
    ]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(
      (
        await resource.database.pool.query("SELECT id FROM artifacts WHERE execution_id=$1", [
          test.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
});
