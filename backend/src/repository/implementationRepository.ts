import { and, asc, count, desc, eq, gt, ilike, max, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { githubRepositorySchema, githubBranchSchema } from "../integrations/github/contracts.js";
import type { AppDatabase } from "../db/index.js";
import {
  executionEvents,
  executions,
  deliveries,
  ticketEvents,
  tickets,
  triages,
} from "../db/schema.js";
import type { PipelineCallback } from "../integrations/ci/callback.js";
import {
  sourceHashesSchema,
  type ImplementationEnvironment,
  type ImplementationTicket,
  type ImplementationTriage,
  type Ticket,
} from "../domain/contracts.js";
import {
  implementationDetailSchema,
  implementationExecutionSchema,
  type ImplementationEventsInput,
  type ImplementationListInput,
  type ImplementationListResult,
  type ImplementationQueueInput,
  type ImplementationQueueResult,
  type StartImplementationInput,
} from "../domain/implementationContracts.js";
import { DomainError } from "../domain/error.js";
import { canStartImplementation } from "../domain/triage.js";
import { transitionTicket } from "../domain/ticket.js";
import { toTicket } from "./ticketRepository.js";
import { createImplementationEvidenceRepository } from "./implementationEvidenceRepository.js";
import { nextExecutionSequence } from "./implementationTransactions.js";
import {
  createImplementationDispatchRepository,
  workflowDispatchIntent,
} from "./implementationDispatchRepository.js";
import { createImplementationDispatchReconciliation } from "./implementationDispatchReconciliation.js";
import { createImplementationReportRepository } from "./implementationReportRepository.js";
import { lockPipelineCallback } from "./implementationCallback.js";
import {
  createImplementationCompletionRepository,
  confirmPipelineDelivery,
  type PipelineSuccessProof,
} from "./implementationCompletionRepository.js";

type Transaction = Parameters<Parameters<AppDatabase["db"]["transaction"]>[0]>[0];
type RuntimeEnvironment = Pick<ImplementationEnvironment, "ready" | "sourceHashes">;

type TriageRow = typeof triages.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;
const deliveryConfigSchema = z.object({
  repository: githubRepositorySchema,
  baseBranch: githubBranchSchema,
});

function toImplementationTicket(ticket: Ticket): ImplementationTicket {
  return {
    id: ticket.id,
    version: ticket.version,
    status: ticket.status,
    classification: ticket.classification,
    currentTriageId: ticket.currentTriageId,
  };
}

function toImplementationTriage(triage: TriageRow | null): ImplementationTriage | null {
  if (!triage) return null;
  const sourceHashes = sourceHashesSchema.safeParse(triage.sourceHashes);
  return {
    id: triage.id,
    ticketId: triage.ticketId,
    ticketVersion: triage.ticketVersion,
    classification: triage.classification,
    status: triage.status,
    sourceHashes: sourceHashes.success ? sourceHashes.data : {},
    changeScope: triage.changeScope,
    acceptanceCriteria: triage.acceptanceCriteria,
    regressionTestPlan: triage.regressionTestPlan,
  };
}

function queueFilter(input: ImplementationQueueInput) {
  const conditions: SQL[] = [eq(tickets.status, "aguardando_implementacao")];
  if (input.classification) conditions.push(eq(tickets.classification, input.classification));
  if (input.q) {
    const pattern = `%${input.q.replace(/[\\%_]/gu, "\\$&")}%`;
    const code = sql<string>`'RES-' || lpad(${tickets.id}::text, greatest(3, length(${tickets.id}::text)), '0')`;
    const search = or(
      ilike(tickets.title, pattern),
      ilike(tickets.description, pattern),
      ilike(code, pattern),
    );
    if (search) conditions.push(search);
  }
  return and(...conditions);
}

function eligibility(
  ticket: TicketRow,
  triage: TriageRow | null,
  environment: RuntimeEnvironment,
  activeExecutionId: string | null,
) {
  return canStartImplementation(
    toImplementationTicket(toTicket(ticket, triage)),
    toImplementationTriage(triage),
    { ...environment, activeExecutionId },
  );
}

function executionDetails(execution: typeof executions.$inferSelect) {
  return implementationExecutionSchema.parse({
    id: execution.id,
    ticketId: execution.ticketId,
    ticketVersion: execution.ticketVersion,
    triageId: execution.triageId,
    deliveryId: execution.deliveryId,
    validatedSha: execution.validatedSha,
    publishedSha: execution.publishedSha,
    status: execution.status,
    stage: execution.stage,
    mode: execution.mode,
    round: execution.round,
    outcome: execution.outcome,
    diagnosis: execution.diagnosis,
    blockerCode: execution.blockerCode,
    blockerMessage: execution.blockerMessage,
    workflowId: execution.workflowId,
    workflowUrl: execution.workflowUrl,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
  });
}

function listFilter(input: ImplementationListInput) {
  const conditions: SQL[] = [eq(executions.kind, "implementation")];
  if (input.ticketId) conditions.push(eq(executions.ticketId, input.ticketId));
  if (input.status) conditions.push(eq(executions.status, input.status));
  return and(...conditions);
}

async function activeExecutionId(connection: AppDatabase["db"] | Transaction) {
  const [execution] = await connection
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.status, "em_andamento"))
    .limit(1);
  return execution?.id ?? null;
}

async function findTriage(tx: Transaction, ticket: TicketRow) {
  if (!ticket.currentTriageId) return null;
  const [triage] = await tx
    .select()
    .from(triages)
    .where(and(eq(triages.id, ticket.currentTriageId), eq(triages.ticketId, ticket.id)))
    .limit(1);
  return triage ?? null;
}

function assertEligibility(
  ticket: TicketRow,
  triage: TriageRow | null,
  environment: RuntimeEnvironment,
  activeId: string | null,
) {
  const result = eligibility(ticket, triage, environment, activeId);
  if (result.eligible) return;
  throw new DomainError(
    result.code === "PRECONDITION_FAILED" ? "PRECONDITION_FAILED" : "CONFLICT",
    result.message,
    result.activeExecutionId,
  );
}

export function createImplementationRepository(database: AppDatabase) {
  return {
    ...createImplementationEvidenceRepository(database),
    ...createImplementationDispatchRepository(database),
    ...createImplementationDispatchReconciliation(database),
    ...createImplementationReportRepository(database),
    ...createImplementationCompletionRepository(database),
    async queue(
      input: ImplementationQueueInput,
      environment: RuntimeEnvironment,
    ): Promise<ImplementationQueueResult> {
      return database.db.transaction(
        async (tx) => {
          const where = queueFilter(input);
          const rows = await tx
            .select({ ticket: tickets, triage: triages })
            .from(tickets)
            .leftJoin(
              triages,
              and(eq(tickets.currentTriageId, triages.id), eq(tickets.id, triages.ticketId)),
            )
            .where(where)
            .orderBy(desc(tickets.updatedAt), desc(tickets.id))
            .offset((input.page - 1) * input.pageSize)
            .limit(input.pageSize);
          const [total] = await tx.select({ value: count() }).from(tickets).where(where);
          const activeId = await activeExecutionId(tx);
          return {
            items: rows.map(({ ticket, triage }) => ({
              ticket: toTicket(ticket, triage),
              eligibility: eligibility(ticket, triage, environment, activeId),
            })),
            total: total?.value ?? 0,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async list(input: ImplementationListInput): Promise<ImplementationListResult> {
      return database.db.transaction(
        async (tx) => {
          const where = listFilter(input);
          const rows = await tx
            .select({ execution: executions, ticket: tickets, triage: triages })
            .from(executions)
            .innerJoin(tickets, eq(tickets.id, executions.ticketId))
            .leftJoin(triages, eq(triages.id, executions.triageId))
            .where(where)
            .orderBy(desc(executions.startedAt), desc(executions.id))
            .offset((input.page - 1) * input.pageSize)
            .limit(input.pageSize);
          const [total] = await tx.select({ value: count() }).from(executions).where(where);
          return {
            items: rows.map(({ execution, ticket, triage }) => ({
              execution: executionDetails(execution),
              ticket: toTicket(ticket, triage),
            })),
            total: total?.value ?? 0,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async events(input: ImplementationEventsInput) {
      const [execution] = await database.db
        .select({ id: executions.id })
        .from(executions)
        .where(and(eq(executions.id, input.executionId), eq(executions.kind, "implementation")))
        .limit(1);
      if (!execution)
        throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
      const rows = await database.db
        .select()
        .from(executionEvents)
        .where(
          and(
            eq(executionEvents.executionId, input.executionId),
            gt(executionEvents.sequence, input.afterSequence),
          ),
        )
        .orderBy(asc(executionEvents.sequence))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit).map((event) => ({
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        stage: event.stage,
        message: event.message,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      }));
      return {
        items,
        nextSequence: items.at(-1)?.sequence ?? input.afterSequence,
        hasMore,
      };
    },

    async byId(executionId: string) {
      const [row] = await database.db
        .select({ execution: executions, ticket: tickets, triage: triages, delivery: deliveries })
        .from(executions)
        .innerJoin(tickets, eq(tickets.id, executions.ticketId))
        .leftJoin(triages, eq(triages.id, executions.triageId))
        .leftJoin(deliveries, eq(deliveries.id, executions.deliveryId))
        .where(and(eq(executions.id, executionId), eq(executions.kind, "implementation")))
        .limit(1);
      if (!row) throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
      return implementationDetailSchema.parse({
        execution: executionDetails(row.execution),
        ticket: toTicket(row.ticket, row.triage),
        triage: row.triage
          ? {
              id: row.triage.id,
              ticketVersion: row.triage.ticketVersion,
              classification: row.triage.classification,
              status: row.triage.status,
              changeScope: row.triage.changeScope,
              acceptanceCriteria: row.triage.acceptanceCriteria,
              regressionTestPlan: row.triage.regressionTestPlan,
            }
          : null,
        delivery: row.delivery
          ? {
              id: row.delivery.id,
              number: row.delivery.number,
              branchName: row.delivery.branchName,
              baseSha: row.delivery.baseSha,
              remoteHeadSha: row.delivery.remoteHeadSha,
              prNumber: row.delivery.prNumber,
              prUrl: row.delivery.prUrl,
              prState: row.delivery.prState,
            }
          : null,
      });
    },

    async markWorkflowDispatched(executionId: string) {
      await database.db.transaction(async (tx) => {
        const [execution] = await tx
          .select({ id: executions.id, status: executions.status })
          .from(executions)
          .where(eq(executions.id, executionId))
          .for("update");
        if (!execution)
          throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        if (execution.status !== "em_andamento") return;
        const [dispatched] = await tx
          .select({ id: executionEvents.id })
          .from(executionEvents)
          .where(
            and(
              eq(executionEvents.executionId, executionId),
              eq(executionEvents.type, "workflow_dispatched"),
            ),
          )
          .limit(1);
        if (dispatched) return;
        await tx.insert(executionEvents).values({
          executionId,
          sequence: await nextExecutionSequence(tx, executionId),
          type: "workflow_dispatched",
          stage: "preparando_ambiente",
          message: "Workflow de implementação disparada.",
        });
      });
    },

    async blockWorkflowDispatch(executionId: string) {
      await database.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ execution: executions, ticket: tickets })
          .from(executions)
          .innerJoin(tickets, eq(tickets.id, executions.ticketId))
          .where(eq(executions.id, executionId))
          .for("update");
        if (!row || row.execution.kind !== "implementation")
          throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        if (row.execution.status !== "em_andamento" || row.execution.workflowId !== null) return;
        if (await workflowDispatchIntent(tx, executionId)) return;
        const message =
          "A workflow não foi disparada. Revise a configuração e o ambiente antes de tentar novamente.";
        await tx
          .update(executions)
          .set({
            status: "bloqueada",
            blockerCode: "WORKFLOW_DISPATCH_FAILED",
            blockerMessage: message,
            outcome: "workflow_dispatch_failed",
            completedAt: sql`clock_timestamp()`,
          })
          .where(eq(executions.id, executionId));
        await tx
          .update(tickets)
          .set({ status: "aberto", updatedAt: sql`clock_timestamp()` })
          .where(eq(tickets.id, row.ticket.id));
        await tx.insert(ticketEvents).values({
          ticketId: row.ticket.id,
          type: "implementation_blocked",
          fromStatus: row.ticket.status,
          toStatus: "aberto",
          message,
          payload: { executionId, version: row.execution.ticketVersion },
          createdAt: sql`clock_timestamp()`,
        });
        await tx.insert(executionEvents).values({
          executionId,
          sequence: await nextExecutionSequence(tx, executionId),
          type: "blocked",
          stage: "preparando_ambiente",
          message,
        });
      });
    },

    async applyPipelineCallback(input: PipelineCallback, proof?: PipelineSuccessProof) {
      return database.db.transaction(async (tx) => {
        const { row, callback, fingerprint, replay } = await lockPipelineCallback(tx, input);
        if (replay) return { applied: false, fingerprint };
        if (callback.status === "success")
          await confirmPipelineDelivery(tx, row, callback, fingerprint, proof);

        const sequence = await nextExecutionSequence(tx, callback.executionId);
        const payload = {
          fingerprint,
          status: callback.status,
          workflowId: callback.workflowId,
          workflowUrl: callback.workflowUrl,
          branch: callback.branch,
          commitSha: callback.commitSha,
          pullRequest: callback.pullRequest,
        };
        let executionStatus:
          | "em_andamento"
          | "bloqueada"
          | "falhou"
          | "concluida"
          | "interrompida" = row.execution.status;
        let outcome = `pipeline_${callback.status}`;
        let ticketStatus = row.ticket.status;
        let blockerCode: string | null = null;
        let blockerMessage: string | null = null;
        if (callback.status === "success" && callback.commitSha && callback.pullRequest) {
          executionStatus = "concluida";
          outcome = "pipeline_succeeded";
          ticketStatus =
            row.ticket.status === "em_andamento" ? "aguardando_revisao" : row.ticket.status;
        } else if (callback.status === "failure" || callback.status === "cancelled") {
          executionStatus = callback.status === "failure" ? "falhou" : "interrompida";
          outcome = `pipeline_${callback.status}`;
          blockerCode = "PIPELINE_FAILED";
          blockerMessage =
            "A pipeline não concluiu a implementação. Faça uma nova tentativa após revisar o diagnóstico.";
          ticketStatus = row.ticket.status === "em_andamento" ? "aberto" : row.ticket.status;
        }
        await tx
          .update(executions)
          .set({
            status: executionStatus,
            outcome,
            blockerCode,
            blockerMessage,
            workflowId: callback.workflowId,
            workflowUrl: callback.workflowUrl,
            ...(callback.status === "success" && callback.commitSha
              ? { publishedSha: callback.commitSha, stage: "publicando_pr" as const }
              : {}),
            ...(executionStatus !== "em_andamento" ? { completedAt: sql`clock_timestamp()` } : {}),
          })
          .where(eq(executions.id, callback.executionId));
        if (ticketStatus !== row.ticket.status) {
          await tx
            .update(tickets)
            .set({ status: ticketStatus, updatedAt: sql`clock_timestamp()` })
            .where(eq(tickets.id, row.ticket.id));
          await tx.insert(ticketEvents).values({
            ticketId: row.ticket.id,
            type:
              callback.status === "success"
                ? "implementation_ready_for_review"
                : "implementation_failed",
            fromStatus: row.ticket.status,
            toStatus: ticketStatus,
            message:
              callback.status === "success"
                ? "A implementação foi concluída e aguarda revisão humana."
                : (blockerMessage ?? "A pipeline não concluiu a implementação."),
            payload: { executionId: callback.executionId, fingerprint },
            createdAt: sql`clock_timestamp()`,
          });
        }
        await tx.insert(executionEvents).values({
          executionId: callback.executionId,
          sequence,
          type: "pipeline_callback",
          stage: executionStatus === "concluida" ? "publicando_pr" : row.execution.stage,
          message: "Callback da pipeline recebido.",
          payload,
          createdAt: sql`clock_timestamp()`,
        });
        return { applied: true, fingerprint };
      });
    },

    async reserve(input: StartImplementationInput, environment: RuntimeEnvironment) {
      return database.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: executions.id, kind: executions.kind, ticketId: executions.ticketId })
          .from(executions)
          .where(eq(executions.requestKey, input.requestKey));
        if (existing) {
          if (existing.ticketId !== input.ticketId || existing.kind !== "implementation")
            throw new DomainError("CONFLICT", "A chave já pertence a outra intenção de execução.");
          return { id: existing.id, reservation: null };
        }

        const [ticket] = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.id, input.ticketId))
          .for("update");
        if (!ticket) throw new DomainError("NOT_FOUND", "Ticket não encontrado.");
        const [reservedWhileWaiting] = await tx
          .select({ id: executions.id, kind: executions.kind, ticketId: executions.ticketId })
          .from(executions)
          .where(eq(executions.requestKey, input.requestKey));
        if (reservedWhileWaiting) {
          if (
            reservedWhileWaiting.ticketId !== input.ticketId ||
            reservedWhileWaiting.kind !== "implementation"
          )
            throw new DomainError("CONFLICT", "A chave já pertence a outra intenção de execução.");
          return { id: reservedWhileWaiting.id, reservation: null };
        }
        if (ticket.version !== input.expectedVersion)
          throw new DomainError(
            "CONFLICT",
            "O ticket foi alterado. Atualize os dados antes de tentar novamente.",
          );

        const triage = await findTriage(tx, ticket);
        const activeId = await activeExecutionId(tx);
        assertEligibility(ticket, triage, environment, activeId);
        const config = deliveryConfigSchema.safeParse(ticket.targetConfigSnapshot);
        if (!config.success)
          throw new DomainError(
            "PRECONDITION_FAILED",
            "A configuração não identifica o repositório e a branch da entrega.",
          );
        const nextStatus = transitionTicket(ticket.status, {
          type: "start_implementation",
          ticket: toImplementationTicket(toTicket(ticket, triage)),
          triage: toImplementationTriage(triage),
          environment: { ...environment, activeExecutionId: activeId },
        });

        const triageSnapshot = triage
          ? {
              id: triage.id,
              ticketId: triage.ticketId,
              ticketVersion: triage.ticketVersion,
              classification: triage.classification,
              status: triage.status,
              sourceHashes: triage.sourceHashes,
              changeScope: triage.changeScope,
              acceptanceCriteria: triage.acceptanceCriteria,
              regressionTestPlan: triage.regressionTestPlan,
            }
          : null;
        const ticketSnapshot = {
          id: ticket.id,
          version: ticket.version,
          targetSystemKey: ticket.targetSystemKey,
          targetConfigVersion: ticket.targetConfigVersion,
          title: ticket.title,
          description: ticket.description,
          expectedBehavior: ticket.expectedBehavior,
          reproductionSteps: ticket.reproductionSteps,
          category: ticket.category,
          classification: ticket.classification,
          triage: triageSnapshot,
        };
        const [created] = await tx
          .insert(executions)
          .values({
            ticketId: ticket.id,
            ticketVersion: ticket.version,
            kind: "implementation",
            triageId: triage?.id,
            requestKey: input.requestKey,
            mode: "initial",
            stage: "preparando_ambiente",
            ticketSnapshot,
            configSnapshot: ticket.targetConfigSnapshot,
            startedAt: sql`clock_timestamp()`,
          })
          .onConflictDoNothing()
          .returning({ id: executions.id });
        if (!created) {
          const [concurrent] = await tx
            .select({ id: executions.id, ticketId: executions.ticketId, kind: executions.kind })
            .from(executions)
            .where(eq(executions.requestKey, input.requestKey));
          if (
            concurrent &&
            concurrent.ticketId === input.ticketId &&
            concurrent.kind === "implementation"
          )
            return { id: concurrent.id, reservation: null };
          throw new DomainError(
            "CONFLICT",
            "Outra execução foi reservada. Aguarde antes de tentar novamente.",
          );
        }

        const [lastDelivery] = await tx
          .select({ number: max(deliveries.number) })
          .from(deliveries)
          .where(eq(deliveries.ticketId, ticket.id));
        const branchName = `resolva/res-${ticket.id}-${created.id.slice(0, 8)}`;
        const [delivery] = await tx
          .insert(deliveries)
          .values({
            ticketId: ticket.id,
            number: (lastDelivery?.number ?? 0) + 1,
            firstExecutionId: created.id,
            repository: config.data.repository,
            baseBranch: config.data.baseBranch,
            branchName,
          })
          .returning({ id: deliveries.id });
        if (!delivery) throw new Error("A entrega não pôde ser reservada.");
        await tx
          .update(executions)
          .set({ deliveryId: delivery.id })
          .where(eq(executions.id, created.id));

        await tx
          .update(tickets)
          .set({ status: nextStatus, updatedAt: sql`clock_timestamp()` })
          .where(eq(tickets.id, ticket.id));
        await tx.insert(ticketEvents).values({
          ticketId: ticket.id,
          type: "implementation_started",
          fromStatus: ticket.status,
          toStatus: nextStatus,
          message: "Implementação iniciada manualmente.",
          payload: {
            executionId: created.id,
            triageId: triage?.id ?? null,
            version: ticket.version,
          },
          createdAt: sql`clock_timestamp()`,
        });
        await tx.insert(executionEvents).values({
          executionId: created.id,
          sequence: 1,
          type: "started",
          stage: "preparando_ambiente",
          message: "Implementação reservada.",
        });
        return {
          id: created.id,
          reservation: {
            executionId: created.id,
            deliveryId: delivery.id,
            branchName,
            ticketId: ticket.id,
            triageId: triage?.id ?? null,
            ticketSnapshot,
            configSnapshot: ticket.targetConfigSnapshot,
          },
        };
      });
    },
  };
}

export type ImplementationRepository = ReturnType<typeof createImplementationRepository>;
export type ImplementationReservation = NonNullable<
  Awaited<ReturnType<ImplementationRepository["reserve"]>>["reservation"]
>;
