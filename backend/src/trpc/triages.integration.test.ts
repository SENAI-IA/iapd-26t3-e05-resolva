import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriageDetail } from "../domain/triageContracts.js";
import { runKiroTriage } from "../integrations/kiro/client.js";
import { createTicketRepository } from "../repository/ticketRepository.js";
import { createTriageRepository } from "../repository/triageRepository.js";
import { createServer } from "../server.js";
import { createTicketService } from "../services/ticketService.js";
import { createTriageService } from "../services/triageService.js";
import { startTestDatabase } from "../test/database.js";
import { testTargetConfig } from "../test/projectConfig.js";

const content = {
  targetSystemKey: "demo",
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "Multiplicar preço pela quantidade.",
  reproductionSteps: null,
  category: "calculo",
};
const report = {
  summary: "O cálculo ignora a quantidade.",
  observedBehavior: "O total contém só o preço unitário.",
  expectedBehavior: "O total multiplica o preço pela quantidade.",
  ruleInterpretation: "O total inclui todas as unidades.",
  diagnosis: "A multiplicação está ausente.",
  references: [{ path: "docs/rules.md", startLine: 1, endLine: 2 }],
  uncertainties: [],
  nextAction: "Aguardar início manual da implementação.",
  changeScope: null,
  acceptanceCriteria: [],
  regressionTestPlan: "Calcular o total com duas unidades.",
  promptVersion: "v1",
  evidence: {
    ruleStatus: "established",
    behavior: "divergent",
    verificationStatus: "succeeded",
    evidenceSufficient: true,
    changeRequested: false,
    expectationMisunderstood: false,
    sources: [{ path: "docs/rules.md", sha256: "a".repeat(64) }],
    questions: [],
    humanReviewRequired: false,
  },
};

let resource: Awaited<ReturnType<typeof startTestDatabase>>;
const servers: ReturnType<typeof createServer>[] = [];

beforeAll(async () => {
  resource = await startTestDatabase();
});
beforeEach(async () => {
  await resource.database.pool.query(
    "TRUNCATE artifacts, execution_events, ticket_events, triages, executions, deliveries, tickets RESTART IDENTITY CASCADE",
  );
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
afterAll(async () => {
  await resource?.stop();
});

function setup(runner?: Parameters<typeof createTriageService>[1]) {
  const tickets = createTicketService(
    createTicketRepository(resource.database),
    testTargetConfig.categories.map((category) => category.slug),
    testTargetConfig,
  );
  const repository = createTriageRepository(resource.database);
  const triages = createTriageService(repository, runner);
  const server = createServer({ ticketService: tickets, triageService: triages });
  servers.push(server);
  const call = (procedure: string, input: unknown, mutation = false) =>
    server.inject({
      method: mutation ? "POST" : "GET",
      url: `/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      headers: {
        host: "localhost:3000",
        ...(mutation ? { "content-type": "application/json" } : {}),
      },
      ...(mutation ? { payload: JSON.stringify(input) } : {}),
    });
  const start = (ticketId: number, requestKey = randomUUID(), expectedVersion = 1) =>
    call("triages.start", { ticketId, expectedVersion, requestKey }, true);
  return { tickets, triages, call, start };
}

function data<T>(response: { statusCode: number; json<T>(): T }) {
  expect(response.statusCode).toBe(200);
  return response.json<{ result: { data: T } }>().result.data;
}

describe("triagem transacional pela API", () => {
  it("entrega snapshot persistido ao executor e publica conclusão sem expor snapshots", async () => {
    const sourcePath = "docs/rules.md";
    const sourceHash = "b3badffee1f0ad9057eb49a566deeb901b2002c0238042a93ab26f2770a88010";
    const runner = vi.fn<NonNullable<Parameters<typeof createTriageService>[1]>>(
      async (reservation) => {
        const { rows } = await resource.database.pool.query<{ ticket_snapshot: unknown }>(
          "SELECT ticket_snapshot FROM executions WHERE id = $1",
          [reservation.executionId],
        );
        expect(rows[0]?.ticket_snapshot).toEqual(reservation.ticket);
        await resource.database.pool.query(
          'UPDATE executions SET config_snapshot = \'{"private":"segredo-interno-ficticio"}\' WHERE id = $1',
          [reservation.executionId],
        );
        return runKiroTriage(
          {
            ...reservation,
            sources: [{ path: sourcePath, text: "Regra vigente\nPreço × quantidade\n" }],
            executable: "/opt/kiro/kiro-cli",
            model: "modelo-ficticio",
            apiKey: "chave-ficticia",
            timeoutSeconds: 30,
          },
          async ({ cwd }) => {
            await writeFile(
              join(cwd, ".resolva", "reports", reservation.executionId, "triage-0.json"),
              JSON.stringify({
                ...report,
                schemaVersion: 1,
                executionId: reservation.executionId,
                ticketId: reservation.ticket.id,
                ticketVersion: reservation.ticket.version,
                kind: "triage",
                phase: "triage",
                round: 0,
                classification: "bug",
                promptVersion: "triage-v1",
                evidence: {
                  ...report.evidence,
                  verificationStatus: "not_run",
                  sources: [{ path: sourcePath, sha256: sourceHash }],
                },
              }),
            );
            return { exitCode: 0 };
          },
        );
      },
    );
    const { tickets, start, triages } = setup(runner);
    const ticket = await tickets.create(content);
    const { triageExecutionId } = data<{ triageExecutionId: string }>(await start(ticket.id));
    await triages.drain();
    const detail = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(detail).toMatchObject({
      version: 1,
      status: "aguardando_implementacao",
      classification: "bug",
    });
    const response = await setup().call("triages.byId", { triageId: detail.currentTriageId });
    expect(data<TriageDetail>(response)).toMatchObject({
      ticketVersion: 1,
      classification: "bug",
      status: "valid",
      summary: report.summary,
      sourceHashes: { [sourcePath]: sourceHash },
      execution: { id: triageExecutionId, kind: "triage", status: "concluida" },
    });
    expect(response.body).not.toMatch(/ticketSnapshot|configSnapshot|segredo-interno-ficticio/u);
    const events = await tickets.events({ ticketId: ticket.id });
    expect(events.items.map(({ type }) => type)).toEqual([
      "created",
      "triage_started",
      "triage_completed",
    ]);
    expect(
      (
        await resource.database.pool.query(
          "SELECT id FROM executions WHERE kind = 'implementation'",
        )
      ).rowCount,
    ).toBe(0);
  });

  it("reutiliza a mesma chave após complementação e preserva as duas conclusões", async () => {
    const runner = vi
      .fn<NonNullable<Parameters<typeof createTriageService>[1]>>()
      .mockResolvedValueOnce({
        ...report,
        evidence: { ...report.evidence, questions: ["Qual quantidade?"] },
      })
      .mockResolvedValueOnce(report);
    const { tickets, call, start, triages } = setup(runner);
    const ticket = await tickets.create(content);
    const key = randomUUID();
    const first = data<{ triageExecutionId: string }>(await start(ticket.id, key));
    await triages.drain();
    const previous = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(previous).toMatchObject({
      status: "aguardando_informacoes",
      classification: "inconclusivo",
    });
    await tickets.provideInformation({
      ticketId: ticket.id,
      expectedVersion: 1,
      message: "Duas unidades.",
    });
    expect(data(await start(ticket.id, key))).toEqual(first);
    expect(runner).toHaveBeenCalledTimes(1);
    expect((await start(ticket.id)).statusCode).toBe(409);
    expect((await start(ticket.id, randomUUID(), 2)).statusCode).toBe(200);
    await triages.drain();
    expect(runner.mock.calls[1]?.[0].ticket).toMatchObject({
      version: 2,
      messages: [
        {
          type: "information_provided",
          message: "Duas unidades.",
          triage: { id: previous.currentTriageId, questions: ["Qual quantidade?"] },
        },
      ],
    });
    const current = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(current.currentTriageId).not.toBe(previous.currentTriageId);
    const old = data<TriageDetail>(
      await call("triages.byId", { triageId: previous.currentTriageId }),
    );
    expect(old).toMatchObject({
      status: "invalidated",
      supersededBy: current.currentTriageId,
      questions: ["Qual quantidade?"],
    });
    const list = data<{ items: TriageDetail[]; total: number }>(
      await call("triages.list", {
        ticketId: ticket.id,
        classification: "bug",
        status: "valid",
        pageSize: 1,
      }),
    );
    expect(list.total).toBe(1);
    expect(list.items.map(({ id }) => id)).toEqual([current.currentTriageId]);
    expect((await call("triages.byId", { triageId: randomUUID() })).statusCode).toBe(404);
  });

  it("reserva uma única execução global e rejeita chave vinculada a outro ticket", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const runner = vi.fn(() => pending);
    const { tickets, start, triages } = setup(runner);
    const a = await tickets.create(content);
    const b = await tickets.create(content);
    const key = randomUUID();
    try {
      const [first, second, other] = await Promise.all([
        start(a.id, key),
        start(a.id, key),
        start(b.id, key),
      ]);
      // Either ticket can win the unique key. Replays for the winning ticket share the same id.
      if (other.statusCode === 200) {
        expect([first.statusCode, second.statusCode]).toEqual([409, 409]);
      } else {
        expect(other.statusCode).toBe(409);
        expect(data(first)).toEqual(data(second));
      }
      const active = data<{ triageExecutionId: string }>(other.statusCode === 200 ? other : first);
      for (const ticket of [a, b]) {
        const blocked = await start(ticket.id);
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json()).toMatchObject({
          error: { data: { code: "CONFLICT", activeExecutionId: active.triageExecutionId } },
        });
      }
      expect(runner).toHaveBeenCalledTimes(1);
      expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(1);
    } finally {
      finish(report);
      await triages.drain();
    }
  });

  it("reverte reserva quando o histórico não pode ser gravado", async () => {
    const runner = vi.fn(async () => report);
    const { tickets, start } = setup(runner);
    const ticket = await tickets.create(content);
    const db = resource.database.pool;
    await db.query(
      "ALTER TABLE ticket_events ADD CONSTRAINT reject_triage_started CHECK (type <> 'triage_started')",
    );
    try {
      expect((await start(ticket.id)).statusCode).toBe(500);
      expect((await tickets.byId({ ticketId: ticket.id })).ticket.status).toBe("aberto");
      expect((await db.query("SELECT id FROM executions")).rowCount).toBe(0);
      expect(runner).not.toHaveBeenCalled();
    } finally {
      await db.query("ALTER TABLE ticket_events DROP CONSTRAINT reject_triage_started");
    }
  });

  it("reverte uma conclusão incompleta e libera o ticket com mensagem pública", async () => {
    const { tickets, start, triages } = setup(async () => report);
    const ticket = await tickets.create(content);
    const db = resource.database.pool;
    await db.query(
      "ALTER TABLE ticket_events ADD CONSTRAINT reject_triage_completed CHECK (type <> 'triage_completed')",
    );
    try {
      expect((await start(ticket.id)).statusCode).toBe(200);
      await triages.drain();
      const detail = await tickets.byId({ ticketId: ticket.id });
      expect(detail).toMatchObject({
        ticket: { status: "aberto", classification: null, currentTriageId: null },
        latestExecution: { status: "falhou" },
      });
      expect((await db.query("SELECT id FROM triages")).rowCount).toBe(0);
      const event = (await tickets.events({ ticketId: ticket.id })).items.at(-1);
      expect(event).toMatchObject({ type: "triage_failed", toStatus: "aberto" });
      expect(JSON.stringify(event)).not.toContain("reject_triage_completed");
    } finally {
      await db.query("ALTER TABLE ticket_events DROP CONSTRAINT reject_triage_completed");
    }
  });

  it("recusa relatório com referência sem fonte e libera a execução para nova tentativa", async () => {
    const { tickets, start, triages, call } = setup(async () => ({
      ...report,
      references: [{ path: "docs/sem-fonte.md", startLine: 1, endLine: 2 }],
    }));
    const ticket = await tickets.create(content);
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    expect(await tickets.byId({ ticketId: ticket.id })).toMatchObject({
      ticket: { status: "aberto", currentTriageId: null },
      latestExecution: { status: "falhou" },
    });
    expect(data(await call("triages.list", { ticketId: ticket.id }))).toMatchObject({ total: 0 });
    const retry = setup(async () => report);
    expect((await retry.start(ticket.id)).statusCode).toBe(200);
    await retry.triages.drain();
    expect((await tickets.byId({ ticketId: ticket.id })).ticket.status).toBe(
      "aguardando_implementacao",
    );
  });

  it("substitui a conclusão vigente sem apagar o histórico ao analisar novamente", async () => {
    const { tickets, start, triages, call } = setup(async () => report);
    const ticket = await tickets.create(content);
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    const { currentTriageId: previous } = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    const { currentTriageId: current } = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(current).not.toBe(previous);
    expect(data(await call("triages.byId", { triageId: previous }))).toMatchObject({
      status: "superseded",
      supersededBy: current,
      ticketVersion: 1,
    });
    expect(data(await call("triages.list", { ticketId: ticket.id }))).toMatchObject({
      items: [{ id: current }, { id: previous }],
      total: 2,
    });
  });

  it("retira o ticket da fila se uma nova análise falhar tecnicamente", async () => {
    const runner = vi
      .fn<NonNullable<Parameters<typeof createTriageService>[1]>>()
      .mockResolvedValueOnce(report)
      .mockRejectedValueOnce(new Error("credencial-interna-ficticia"));
    const { tickets, start, triages } = setup(runner);
    const ticket = await tickets.create(content);
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    const previous = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(previous.status).toBe("aguardando_implementacao");
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    expect(await tickets.byId({ ticketId: ticket.id })).toMatchObject({
      ticket: { status: "aberto", currentTriageId: previous.currentTriageId },
      latestExecution: { status: "falhou" },
    });
    const events = await tickets.events({ ticketId: ticket.id });
    expect(events.items.at(-1)).toMatchObject({ type: "triage_failed", toStatus: "aberto" });
    expect(JSON.stringify(events)).not.toContain("credencial-interna-ficticia");
  });

  it("registra revisão humana quando uma verificação autorizada falha", async () => {
    const { tickets, start, triages, call } = setup(async () => ({
      ...report,
      summary: "A compilação não terminou.",
      evidence: { ...report.evidence, verificationStatus: "failed" },
    }));
    const ticket = await tickets.create(content);
    expect((await start(ticket.id)).statusCode).toBe(200);
    await triages.drain();
    const current = (await tickets.byId({ ticketId: ticket.id })).ticket;
    expect(current).toMatchObject({ status: "aberto", classification: "inconclusivo" });
    expect(data(await call("triages.byId", { triageId: current.currentTriageId }))).toMatchObject({
      classification: "inconclusivo",
      summary: "A compilação não terminou.",
      uncertainties: ["Uma verificação autorizada falhou."],
      nextAction: "Revise as evidências da triagem.",
      execution: { status: "concluida", outcome: "human_review_required" },
    });
  });

  it("permite consultar sem executor e recusa reservar uma triagem que não pode executar", async () => {
    const { tickets, start, call } = setup();
    const ticket = await tickets.create(content);
    expect((await start(ticket.id)).statusCode).toBe(412);
    expect(data(await call("triages.list", {}))).toMatchObject({ items: [], total: 0 });
    expect((await resource.database.pool.query("SELECT id FROM executions")).rowCount).toBe(0);
    expect((await tickets.byId({ ticketId: ticket.id })).ticket.status).toBe("aberto");
  });
});
