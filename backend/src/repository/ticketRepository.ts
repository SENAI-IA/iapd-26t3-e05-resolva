import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { TargetSystemConfigSnapshot } from "../config/project.js";
import type { AppDatabase } from "../db/index.js";
import {
  deliveries,
  executions,
  ticketEvents,
  tickets,
  triages,
  type JsonObject,
} from "../db/schema.js";
import type {
  ListTicketsInput,
  Ticket,
  TicketContent,
  TicketDetails,
  TicketEvents,
  TicketEventsInput,
  TicketList,
} from "../domain/contracts.js";
import { DomainError } from "../domain/error.js";
import { transitionTicket } from "../domain/ticket.js";

export type TicketMutation = { ticketId: number; expectedVersion: number } & (
  | {
      type: "edit";
      content: TicketContent;
      targetConfigSnapshot: TargetSystemConfigSnapshot;
    }
  | { type: "provide_information" | "contest_triage" | "reopen"; message: string }
  | {
      type: "resolve";
      mergeConfirmed: boolean;
      testVerified: boolean;
      message?: string | undefined;
    }
);

type Transaction = Parameters<Parameters<AppDatabase["db"]["transaction"]>[0]>[0];
type Connection = AppDatabase["db"] | Transaction;
const selection = {
  ticket: tickets,
  triage: { status: triages.status, ticketVersion: triages.ticketVersion },
};

function toTicket(
  row: typeof tickets.$inferSelect,
  triage: Pick<typeof triages.$inferSelect, "status" | "ticketVersion"> | null = null,
): Ticket {
  return {
    id: row.id,
    code: `RES-${String(row.id).padStart(3, "0")}`,
    targetSystemKey: row.targetSystemKey,
    targetConfigVersion: row.targetConfigVersion,
    title: row.title,
    description: row.description,
    expectedBehavior: row.expectedBehavior,
    reproductionSteps: row.reproductionSteps,
    category: row.category,
    status: row.status,
    version: row.version,
    classification: row.classification,
    currentTriageId: row.currentTriageId,
    triageStatus: triage?.status ?? null,
    triageVersion: triage?.ticketVersion ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

async function readTicket(connection: Connection, id: number): Promise<Ticket> {
  const [row] = await connection
    .select(selection)
    .from(tickets)
    .leftJoin(
      triages,
      and(eq(tickets.currentTriageId, triages.id), eq(tickets.id, triages.ticketId)),
    )
    .where(eq(tickets.id, id))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Ticket não encontrado.");
  return toTicket(row.ticket, row.triage);
}

function filter(input: ListTicketsInput) {
  const conditions: SQL[] = [];
  if (input.status) conditions.push(eq(tickets.status, input.status));
  if (input.category) conditions.push(eq(tickets.category, input.category));
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

const eventTypes = {
  edit: "updated",
  provide_information: "information_provided",
  contest_triage: "triage_contested",
  resolve: "resolved",
  reopen: "reopened",
} as const;

export function createTicketRepository(database: AppDatabase) {
  return {
    async create(
      content: TicketContent,
      targetConfigSnapshot: TargetSystemConfigSnapshot,
    ): Promise<Ticket> {
      return database.db.transaction(async (tx) => {
        const [ticket] = await tx
          .insert(tickets)
          .values({
            ...content,
            targetConfigVersion: targetConfigSnapshot.version,
            targetConfigSnapshot,
          })
          .returning();
        if (!ticket) throw new Error("Não foi possível criar o ticket.");
        await tx.insert(ticketEvents).values({
          ticketId: ticket.id,
          type: "created",
          toStatus: "aberto",
          message: "Ticket cadastrado.",
          payload: { version: 1 },
        });
        return toTicket(ticket);
      });
    },
    async list(input: ListTicketsInput): Promise<TicketList> {
      return database.db.transaction(
        async (tx) => {
          const where = filter(input);
          const rows = await tx
            .select(selection)
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
          return {
            items: rows.map((row) => toTicket(row.ticket, row.triage)),
            total: total?.value ?? 0,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async byId(ticketId: number): Promise<TicketDetails> {
      return database.db.transaction(
        async (tx) => {
          const ticket = await readTicket(tx, ticketId);
          const [execution] = await tx
            .select({
              id: executions.id,
              kind: executions.kind,
              status: executions.status,
              stage: executions.stage,
              startedAt: executions.startedAt,
              completedAt: executions.completedAt,
            })
            .from(executions)
            .where(eq(executions.ticketId, ticketId))
            .orderBy(desc(executions.startedAt), desc(executions.id))
            .limit(1);
          const [delivery] = await tx
            .select({
              id: deliveries.id,
              number: deliveries.number,
              prNumber: deliveries.prNumber,
              prUrl: deliveries.prUrl,
              prState: deliveries.prState,
            })
            .from(deliveries)
            .where(eq(deliveries.ticketId, ticketId))
            .orderBy(desc(deliveries.number))
            .limit(1);
          return {
            ticket,
            latestExecution: execution
              ? {
                  ...execution,
                  startedAt: execution.startedAt.toISOString(),
                  completedAt: execution.completedAt?.toISOString() ?? null,
                }
              : null,
            currentDelivery: delivery ?? null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async events(input: TicketEventsInput): Promise<TicketEvents> {
      return database.db.transaction(
        async (tx) => {
          await readTicket(tx, input.ticketId);
          const rows = await tx
            .select()
            .from(ticketEvents)
            .where(eq(ticketEvents.ticketId, input.ticketId))
            .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id))
            .offset((input.page - 1) * input.pageSize)
            .limit(input.pageSize);
          const [total] = await tx
            .select({ value: count() })
            .from(ticketEvents)
            .where(eq(ticketEvents.ticketId, input.ticketId));
          return {
            items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
            total: total?.value ?? 0,
            page: input.page,
            pageSize: input.pageSize,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async mutate(input: TicketMutation): Promise<Ticket> {
      return database.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.id, input.ticketId))
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND", "Ticket não encontrado.");
        if (current.version !== input.expectedVersion)
          throw new DomainError(
            "CONFLICT",
            "O ticket foi alterado. Atualize os dados antes de tentar novamente.",
          );
        const status = transitionTicket(current.status, input);
        if (input.type === "contest_triage") {
          const ticket = await readTicket(tx, input.ticketId);
          if (
            !ticket.currentTriageId ||
            !ticket.triageStatus ||
            !["falso_positivo", "entendimento_incorreto"].includes(ticket.classification ?? "")
          ) {
            throw new DomainError("CONFLICT", "Não há uma recusa de triagem para contestar.");
          }
        }
        if (input.type !== "resolve") {
          await tx
            .update(triages)
            .set({ status: "invalidated", invalidatedAt: sql`clock_timestamp()` })
            .where(and(eq(triages.ticketId, input.ticketId), eq(triages.status, "valid")));
        }
        await tx
          .update(tickets)
          .set({
            ...(input.type === "edit"
              ? {
                  ...input.content,
                  targetConfigVersion: input.targetConfigSnapshot.version,
                  targetConfigSnapshot: input.targetConfigSnapshot,
                }
              : {}),
            status,
            version: current.version + 1,
            updatedAt: sql`clock_timestamp()`,
            resolvedAt:
              input.type === "resolve"
                ? sql`clock_timestamp()`
                : input.type === "reopen"
                  ? null
                  : current.resolvedAt,
          })
          .where(eq(tickets.id, input.ticketId));
        const payload: JsonObject = { version: current.version + 1 };
        if (
          current.currentTriageId &&
          (input.type === "provide_information" ||
            input.type === "contest_triage" ||
            input.type === "reopen")
        ) {
          payload.triageId = current.currentTriageId;
        }
        if (input.type === "resolve") {
          payload.mergeConfirmed = input.mergeConfirmed;
          payload.testVerified = input.testVerified;
        }
        const message = "message" in input ? input.message : undefined;
        await tx.insert(ticketEvents).values({
          ticketId: input.ticketId,
          type: eventTypes[input.type],
          fromStatus: current.status,
          toStatus: status,
          message:
            message ??
            (input.type === "resolve"
              ? "Merge e verificação em teste confirmados pelo operador."
              : "Conteúdo do ticket atualizado."),
          payload,
          createdAt: sql`clock_timestamp()`,
        });
        return readTicket(tx, input.ticketId);
      });
    },
  };
}
export type TicketRepository = ReturnType<typeof createTicketRepository>;
