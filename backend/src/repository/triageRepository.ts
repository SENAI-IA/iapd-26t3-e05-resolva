import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { executionEvents, executions, ticketEvents, tickets, triages } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import { transitionTicket } from "../domain/ticket.js";
import { classifyTriage } from "../domain/triage.js";
import {
  triageDetailSchema,
  triageReportSchema,
  type ListTriagesInput,
  type StartTriageInput,
} from "../domain/triageContracts.js";

type Transaction = Parameters<Parameters<AppDatabase["db"]["transaction"]>[0]>[0];
type Execution = typeof executions.$inferSelect;

const triageSelection = {
  id: triages.id,
  ticketId: triages.ticketId,
  ticketVersion: triages.ticketVersion,
  classification: triages.classification,
  status: triages.status,
  summary: triages.summary,
  observedBehavior: triages.observedBehavior,
  expectedBehavior: triages.expectedBehavior,
  ruleInterpretation: triages.ruleInterpretation,
  diagnosis: triages.diagnosis,
  sources: triages.sources,
  references: triages.references,
  questions: triages.questions,
  uncertainties: triages.uncertainties,
  nextAction: triages.nextAction,
  changeScope: triages.changeScope,
  acceptanceCriteria: triages.acceptanceCriteria,
  regressionTestPlan: triages.regressionTestPlan,
  sourceHashes: triages.sourceHashes,
  promptVersion: triages.promptVersion,
  createdAt: triages.createdAt,
  invalidatedAt: triages.invalidatedAt,
  supersededBy: triages.supersededBy,
  execution: {
    id: executions.id,
    kind: executions.kind,
    status: executions.status,
    stage: executions.stage,
    outcome: executions.outcome,
    startedAt: executions.startedAt,
    completedAt: executions.completedAt,
  },
};

type DetailRow = Omit<typeof triages.$inferSelect, "ticketSnapshot" | "executionId"> & {
  execution: Pick<
    Execution,
    "id" | "kind" | "status" | "stage" | "outcome" | "startedAt" | "completedAt"
  >;
};

function toDetail(row: DetailRow) {
  return triageDetailSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    execution: {
      ...row.execution,
      startedAt: row.execution.startedAt.toISOString(),
      completedAt: row.execution.completedAt?.toISOString() ?? null,
    },
  });
}

async function lockTicket(tx: Transaction, ticketId: number) {
  const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
  if (!ticket) throw new DomainError("NOT_FOUND", "Ticket não encontrado.");
  return ticket;
}

async function replay(tx: Transaction, input: StartTriageInput) {
  const [existing] = await tx
    .select({
      id: executions.id,
      kind: executions.kind,
      ticketId: executions.ticketId,
    })
    .from(executions)
    .where(eq(executions.requestKey, input.requestKey));
  if (!existing) return null;
  if (existing.ticketId !== input.ticketId || existing.kind !== "triage")
    throw new DomainError("CONFLICT", "A chave já pertence a outra intenção de execução.");
  return { id: existing.id, reservation: null };
}

async function assertNoActiveExecution(tx: Transaction) {
  const [active] = await tx
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.status, "em_andamento"))
    .limit(1);
  if (active)
    throw new DomainError("CONFLICT", "Aguarde o término da execução em andamento.", active.id);
}

async function lockTriageExecution(tx: Transaction, executionId: string) {
  const [identity] = await tx
    .select({ ticketId: executions.ticketId })
    .from(executions)
    .where(and(eq(executions.id, executionId), eq(executions.kind, "triage")));
  if (!identity) throw new DomainError("NOT_FOUND", "Execução de triagem não encontrada.");
  const ticket = await lockTicket(tx, identity.ticketId);
  const [execution] = await tx
    .select()
    .from(executions)
    .where(eq(executions.id, executionId))
    .for("update");
  if (!execution) throw new DomainError("NOT_FOUND", "Execução de triagem não encontrada.");
  return { ticket, execution };
}

function assertCurrent(ticket: typeof tickets.$inferSelect, execution: Execution) {
  if (ticket.status !== "em_triagem" || ticket.version !== execution.ticketVersion)
    throw new DomainError("CONFLICT", "O ticket mudou durante a triagem.");
}

export function createTriageRepository(database: AppDatabase) {
  return {
    async reserve(input: StartTriageInput, runnerAvailable: boolean) {
      return database.db.transaction(async (tx) => {
        const ticket = await lockTicket(tx, input.ticketId);
        const existing = await replay(tx, input);
        if (existing) return existing;
        if (!runnerAvailable)
          throw new DomainError(
            "PRECONDITION_FAILED",
            "O executor de triagem ainda não está disponível.",
          );
        if (ticket.version !== input.expectedVersion)
          throw new DomainError(
            "CONFLICT",
            "O ticket foi alterado. Atualize os dados antes de tentar novamente.",
          );
        await assertNoActiveExecution(tx);
        const status = transitionTicket(ticket.status, { type: "analyze" });
        const messages = await tx
          .select({
            type: ticketEvents.type,
            message: ticketEvents.message,
            triage: { id: triages.id, summary: triages.summary, questions: triages.questions },
          })
          .from(ticketEvents)
          .leftJoin(
            triages,
            and(
              eq(triages.ticketId, ticketEvents.ticketId),
              sql`${triages.id}::text = ${ticketEvents.payload}->>'triageId'`,
            ),
          )
          .where(
            and(
              eq(ticketEvents.ticketId, ticket.id),
              inArray(ticketEvents.type, ["information_provided", "triage_contested", "reopened"]),
            ),
          )
          .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
        const snapshot = {
          id: ticket.id,
          version: ticket.version,
          status: ticket.status,
          targetSystemKey: ticket.targetSystemKey,
          targetConfigVersion: ticket.targetConfigVersion,
          targetConfigSnapshot: ticket.targetConfigSnapshot,
          title: ticket.title,
          description: ticket.description,
          expectedBehavior: ticket.expectedBehavior,
          reproductionSteps: ticket.reproductionSteps,
          category: ticket.category,
          messages,
        };
        const [created] = await tx
          .insert(executions)
          .values({
            ticketId: ticket.id,
            ticketVersion: ticket.version,
            kind: "triage",
            requestKey: input.requestKey,
            stage: "preparando_contexto",
            ticketSnapshot: snapshot,
            configSnapshot: ticket.targetConfigSnapshot,
            startedAt: sql`clock_timestamp()`,
          })
          .onConflictDoNothing()
          .returning({ id: executions.id });
        if (!created) {
          const concurrentReplay = await replay(tx, input);
          if (concurrentReplay) return concurrentReplay;
          await assertNoActiveExecution(tx);
          throw new DomainError(
            "CONFLICT",
            "Outra execução foi reservada. Aguarde antes de tentar novamente.",
          );
        }
        await tx
          .update(tickets)
          .set({ status, updatedAt: sql`clock_timestamp()` })
          .where(eq(tickets.id, ticket.id));
        await tx.insert(ticketEvents).values({
          ticketId: ticket.id,
          type: "triage_started",
          fromStatus: ticket.status,
          toStatus: status,
          message: "Triagem solicitada.",
          payload: { executionId: created.id, version: ticket.version },
          createdAt: sql`clock_timestamp()`,
        });
        await tx.insert(executionEvents).values({
          executionId: created.id,
          sequence: 1,
          type: "started",
          stage: "preparando_contexto",
          message: "Triagem reservada.",
        });
        return { id: created.id, reservation: { executionId: created.id, ticket: snapshot } };
      });
    },

    async complete(executionId: string, input: unknown) {
      const { evidence, ...report } = triageReportSchema.parse(input);
      const decision = classifyTriage(evidence);
      const uncertainties = [...report.uncertainties];
      if (evidence.verificationStatus === "failed")
        uncertainties.push("Uma verificação autorizada falhou.");
      if (evidence.verificationStatus === "unavailable")
        uncertainties.push("Uma verificação autorizada estava indisponível.");
      let nextAction = report.nextAction;
      if (decision.questions.length > 0) nextAction = "Responda às perguntas da triagem.";
      else if (decision.humanReviewRequired) nextAction = "Revise as evidências da triagem.";
      return database.db.transaction(async (tx) => {
        const { ticket, execution } = await lockTriageExecution(tx, executionId);
        if (execution.status === "concluida" && execution.triageId) return execution.triageId;
        if (execution.status !== "em_andamento")
          throw new DomainError("CONFLICT", "A execução de triagem não está ativa.");
        assertCurrent(ticket, execution);
        const [triage] = await tx
          .insert(triages)
          .values({
            ...report,
            uncertainties,
            nextAction,
            ticketId: ticket.id,
            ticketVersion: execution.ticketVersion,
            ticketSnapshot: execution.ticketSnapshot,
            executionId,
            classification: decision.classification,
            sources: evidence.sources,
            questions: decision.questions,
            sourceHashes: Object.fromEntries(
              evidence.sources.map(({ path, sha256 }) => [path, sha256]),
            ),
            createdAt: sql`clock_timestamp()`,
          })
          .returning({ id: triages.id });
        if (!triage) throw new Error("Não foi possível salvar a triagem.");
        if (ticket.currentTriageId) {
          await tx
            .update(triages)
            .set({
              supersededBy: triage.id,
              status: sql`CASE WHEN ${triages.status} = 'valid' THEN 'superseded'::triage_status ELSE ${triages.status} END`,
            })
            .where(and(eq(triages.id, ticket.currentTriageId), eq(triages.ticketId, ticket.id)));
        }
        await tx
          .update(tickets)
          .set({
            status: decision.status,
            classification: decision.classification,
            currentTriageId: triage.id,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(tickets.id, ticket.id));
        await tx
          .update(executions)
          .set({
            status: "concluida",
            stage: "consolidando_triagem",
            triageId: triage.id,
            outcome:
              decision.questions.length > 0
                ? "needs_information"
                : decision.humanReviewRequired
                  ? "human_review_required"
                  : "classified",
            completedAt: sql`clock_timestamp()`,
          })
          .where(eq(executions.id, executionId));
        await tx.insert(ticketEvents).values({
          ticketId: ticket.id,
          type: "triage_completed",
          fromStatus: ticket.status,
          toStatus: decision.status,
          message: report.summary,
          payload: {
            executionId,
            triageId: triage.id,
            version: ticket.version,
            classification: decision.classification,
          },
          createdAt: sql`clock_timestamp()`,
        });
        await tx.insert(executionEvents).values({
          executionId,
          sequence: 2,
          type: "completed",
          stage: "consolidando_triagem",
          message: "Conclusão da triagem registrada.",
        });
        return triage.id;
      });
    },

    async fail(executionId: string) {
      return database.db.transaction(async (tx) => {
        const { ticket, execution } = await lockTriageExecution(tx, executionId);
        if (execution.status !== "em_andamento") return;
        const message = "Não foi possível concluir a triagem. Tente novamente.";
        await tx
          .update(executions)
          .set({
            status: "falhou",
            outcome: "technical_failure",
            blockerMessage: message,
            completedAt: sql`clock_timestamp()`,
          })
          .where(eq(executions.id, executionId));
        const restore =
          ticket.status === "em_triagem" && ticket.version === execution.ticketVersion;
        const status = restore ? "aberto" : ticket.status;
        if (restore) {
          await tx
            .update(tickets)
            .set({ status, updatedAt: sql`clock_timestamp()` })
            .where(eq(tickets.id, ticket.id));
        }
        await tx.insert(ticketEvents).values({
          ticketId: ticket.id,
          type: "triage_failed",
          fromStatus: ticket.status,
          toStatus: status,
          message,
          payload: { executionId, version: execution.ticketVersion },
          createdAt: sql`clock_timestamp()`,
        });
        await tx.insert(executionEvents).values({
          executionId,
          sequence: 2,
          type: "failed",
          message,
        });
      });
    },

    async byId(triageId: string) {
      const [row] = await database.db
        .select(triageSelection)
        .from(triages)
        .innerJoin(executions, eq(triages.executionId, executions.id))
        .where(eq(triages.id, triageId));
      if (!row) throw new DomainError("NOT_FOUND", "Triagem não encontrada.");
      return toDetail(row);
    },

    async list(input: ListTriagesInput) {
      const where = and(
        input.ticketId === undefined ? undefined : eq(triages.ticketId, input.ticketId),
        input.classification === undefined
          ? undefined
          : eq(triages.classification, input.classification),
        input.status === undefined ? undefined : eq(triages.status, input.status),
      );
      return database.db.transaction(
        async (tx) => {
          const rows = await tx
            .select(triageSelection)
            .from(triages)
            .innerJoin(executions, eq(triages.executionId, executions.id))
            .where(where)
            .orderBy(desc(triages.createdAt), desc(triages.id))
            .offset((input.page - 1) * input.pageSize)
            .limit(input.pageSize);
          const [total] = await tx.select({ value: count() }).from(triages).where(where);
          return {
            items: rows.map(toDetail),
            total: total?.value ?? 0,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}

export type TriageRepository = ReturnType<typeof createTriageRepository>;
