import { asc, eq, max, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { executionEvents, executions, ticketEvents, tickets } from "../db/schema.js";
import type { InstanceGuard } from "./instanceGuard.js";

type Transaction = Parameters<Parameters<AppDatabase["db"]["transaction"]>[0]>[0];

async function nextExecutionSequence(tx: Transaction, executionId: string) {
  const [row] = await tx
    .select({ value: max(executionEvents.sequence) })
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId));
  return Number(row?.value ?? 0) + 1;
}

export async function recoverInterruptedExecutions(
  database: AppDatabase,
  guard: Pick<InstanceGuard, "assertOwned">,
): Promise<number> {
  await guard.assertOwned();
  return database.db.transaction(async (tx) => {
    await guard.assertOwned();
    const active = await tx
      .select({ execution: executions, ticket: tickets })
      .from(executions)
      .innerJoin(tickets, eq(tickets.id, executions.ticketId))
      .where(eq(executions.status, "em_andamento"))
      .orderBy(asc(executions.startedAt), asc(executions.id))
      .for("update");
    for (const row of active) {
      await guard.assertOwned();
      const message = "A execução foi interrompida após a recuperação da instância.";
      const sequence = await nextExecutionSequence(tx, row.execution.id);
      await tx
        .update(executions)
        .set({
          status: "interrompida",
          outcome: "interrupted_by_recovery",
          blockerCode: "PROCESS_RECOVERY",
          blockerMessage: message,
          completedAt: sql`clock_timestamp()`,
        })
        .where(eq(executions.id, row.execution.id));
      const nextTicketStatus =
        row.ticket.status === "em_andamento" || row.ticket.status === "em_triagem"
          ? "aberto"
          : row.ticket.status;
      if (nextTicketStatus !== row.ticket.status) {
        await tx
          .update(tickets)
          .set({ status: nextTicketStatus, updatedAt: sql`clock_timestamp()` })
          .where(eq(tickets.id, row.ticket.id));
        await tx.insert(ticketEvents).values({
          ticketId: row.ticket.id,
          type: "execution_interrupted",
          fromStatus: row.ticket.status,
          toStatus: nextTicketStatus,
          message,
          payload: { executionId: row.execution.id, kind: row.execution.kind },
          createdAt: sql`clock_timestamp()`,
        });
      }
      await tx.insert(executionEvents).values({
        executionId: row.execution.id,
        sequence,
        type: "interrupted",
        stage: row.execution.stage,
        message,
        payload: { reason: "process_recovery" },
        createdAt: sql`clock_timestamp()`,
      });
    }
    await guard.assertOwned();
    return active.length;
  });
}
