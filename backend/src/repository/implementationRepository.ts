import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { executionEvents, executions, ticketEvents, tickets, triages } from "../db/schema.js";
import {
  sourceHashesSchema,
  type ImplementationEnvironment,
  type ImplementationTicket,
  type ImplementationTriage,
  type Ticket,
} from "../domain/contracts.js";
import {
  type ImplementationQueueInput,
  type ImplementationQueueResult,
  type StartImplementationInput,
} from "../domain/implementationContracts.js";
import { DomainError } from "../domain/error.js";
import { canStartImplementation } from "../domain/triage.js";
import { transitionTicket } from "../domain/ticket.js";
import { toTicket } from "./ticketRepository.js";

type Transaction = Parameters<Parameters<AppDatabase["db"]["transaction"]>[0]>[0];
type RuntimeEnvironment = Pick<ImplementationEnvironment, "ready" | "sourceHashes">;

type TriageRow = typeof triages.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;

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
        if (ticket.version !== input.expectedVersion)
          throw new DomainError(
            "CONFLICT",
            "O ticket foi alterado. Atualize os dados antes de tentar novamente.",
          );

        const triage = await findTriage(tx, ticket);
        const activeId = await activeExecutionId(tx);
        assertEligibility(ticket, triage, environment, activeId);
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
