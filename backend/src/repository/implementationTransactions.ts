import { and, eq, max } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { executionEvents } from "../db/schema.js";

export type ImplementationTransaction = Parameters<
  Parameters<AppDatabase["db"]["transaction"]>[0]
>[0];

export async function nextExecutionSequence(tx: ImplementationTransaction, executionId: string) {
  const [event] = await tx
    .select({ value: max(executionEvents.sequence) })
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId));
  return Number(event?.value ?? 0) + 1;
}

export async function validationEvent(tx: ImplementationTransaction, executionId: string) {
  const [event] = await tx
    .select({ payload: executionEvents.payload })
    .from(executionEvents)
    .where(
      and(
        eq(executionEvents.executionId, executionId),
        eq(executionEvents.type, "validation_approved"),
      ),
    )
    .limit(1);
  return event;
}
