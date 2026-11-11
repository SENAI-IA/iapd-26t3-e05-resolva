import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/index.js";
import { executions, tickets, executionEvents } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import {
  githubRunIdSchema,
  githubWorkflowFileSchema,
  githubNumberSchema,
} from "../integrations/github/contracts.js";
import {
  nextExecutionSequence,
  type ImplementationTransaction,
} from "./implementationTransactions.js";
import {
  dispatchConfigSchema,
  dispatchCheckpointSchema,
  dispatchReconciliationResultSchema,
} from "../domain/implementationDispatch.js";

const definitionSchema = z.strictObject({ id: githubRunIdSchema, path: githubWorkflowFileSchema });
const observationSchema = z.object({
  fingerprint: z.string(),
  workflowAttempt: githubNumberSchema,
  result: dispatchReconciliationResultSchema,
});

export async function workflowDispatchIntent(tx: ImplementationTransaction, executionId: string) {
  const [event] = await tx
    .select({
      id: executionEvents.id,
      payload: executionEvents.payload,
      createdAt: executionEvents.createdAt,
    })
    .from(executionEvents)
    .where(
      and(
        eq(executionEvents.executionId, executionId),
        eq(executionEvents.type, "workflow_dispatch_requested"),
      ),
    )
    .limit(1);
  return event;
}

export async function workflowDispatchConstraints(
  tx: ImplementationTransaction,
  execution: Pick<typeof executions.$inferSelect, "id" | "configSnapshot">,
) {
  const intent = await workflowDispatchIntent(tx, execution.id);
  if (!intent) return null;
  const checkpoint = dispatchCheckpointSchema.safeParse(intent.payload);
  const config = dispatchConfigSchema.safeParse(execution.configSnapshot);
  if (!checkpoint.success || !config.success)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A execução não possui um checkpoint de disparo válido.",
    );
  const selector = config.data.workflowRef.replace(/^\.github\/workflows\//u, "");
  if (
    checkpoint.data.repository !== config.data.repository ||
    checkpoint.data.baseBranch !== config.data.baseBranch ||
    checkpoint.data.workflowSelector !== config.data.workflowRef ||
    (/^[0-9]+$/u.test(selector)
      ? checkpoint.data.workflowDefinitionId !== selector
      : checkpoint.data.workflowPath !== `.github/workflows/${selector}`)
  )
    throw new DomainError("CONFLICT", "O checkpoint diverge da configuração reservada.");
  const [latest] = await tx
    .select({ payload: executionEvents.payload })
    .from(executionEvents)
    .where(
      and(
        eq(executionEvents.executionId, execution.id),
        eq(executionEvents.type, "workflow_dispatch_reconciled"),
      ),
    )
    .orderBy(desc(executionEvents.sequence))
    .limit(1);
  const previous = latest ? observationSchema.safeParse(latest.payload) : null;
  if (previous && !previous.success)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "O histórico de reconciliação da workflow está inválido.",
    );
  return {
    executionId: execution.id,
    repository: config.data.repository,
    baseBranch: config.data.baseBranch,
    workflowDefinitionId: checkpoint.data.workflowDefinitionId,
    requestedAt: intent.createdAt.toISOString(),
    checkpointFingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          id: intent.id,
          createdAt: intent.createdAt.toISOString(),
          payload: checkpoint.data,
        }),
      )
      .digest("hex"),
    observation: previous?.success ? previous.data : null,
  };
}

export function createImplementationDispatchRepository(database: AppDatabase) {
  return {
    async beginWorkflowDispatch(executionId: string, input: z.infer<typeof definitionSchema>) {
      const definition = definitionSchema.parse(input);
      return database.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ execution: executions, ticket: tickets })
          .from(executions)
          .innerJoin(tickets, eq(tickets.id, executions.ticketId))
          .where(and(eq(executions.id, executionId), eq(executions.kind, "implementation")))
          .for("update");
        if (!row) throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        if (await workflowDispatchIntent(tx, executionId)) return { applied: false };
        if (
          row.execution.status !== "em_andamento" ||
          row.execution.workflowId !== null ||
          row.ticket.status !== "em_andamento" ||
          row.ticket.version !== row.execution.ticketVersion
        )
          throw new DomainError("CONFLICT", "A execução não pode iniciar outro disparo.");
        const config = dispatchConfigSchema.safeParse(row.execution.configSnapshot);
        if (!config.success)
          throw new DomainError(
            "PRECONDITION_FAILED",
            "A configuração não identifica a workflow da implementação.",
          );
        const selector = config.data.workflowRef.replace(/^\.github\/workflows\//u, "");
        if (
          /^[0-9]+$/u.test(selector)
            ? definition.id !== selector
            : definition.path !== `.github/workflows/${selector}`
        )
          throw new DomainError(
            "CONFLICT",
            "A definição da workflow diverge da configuração reservada.",
          );
        await tx.insert(executionEvents).values({
          executionId,
          sequence: await nextExecutionSequence(tx, executionId),
          type: "workflow_dispatch_requested",
          stage: "preparando_ambiente",
          message: "Disparo da workflow autorizado e registrado antes do envio.",
          payload: {
            repository: config.data.repository,
            baseBranch: config.data.baseBranch,
            workflowSelector: config.data.workflowRef,
            workflowDefinitionId: definition.id,
            workflowPath: definition.path,
          },
          createdAt: sql`clock_timestamp()`,
        });
        await tx
          .update(executions)
          .set({ outcome: "workflow_dispatch_pending" })
          .where(eq(executions.id, executionId));
        return { applied: true };
      });
    },
    async markWorkflowDispatchUnconfirmed(executionId: string) {
      return database.db.transaction(async (tx) => {
        const [execution] = await tx
          .select()
          .from(executions)
          .where(and(eq(executions.id, executionId), eq(executions.kind, "implementation")))
          .for("update");
        if (!execution)
          throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        if (execution.status !== "em_andamento" || execution.workflowId !== null)
          return { workflowKnown: execution.workflowId !== null };
        const intent = await workflowDispatchIntent(tx, executionId);
        if (!intent)
          throw new DomainError(
            "PRECONDITION_FAILED",
            "A execução não possui checkpoint de disparo.",
          );
        if (execution.outcome !== "workflow_dispatch_unconfirmed") {
          const message =
            "A resposta do disparo não foi confirmada. Reconcilie a workflow antes de iniciar outra implementação.";
          await tx
            .update(executions)
            .set({
              outcome: "workflow_dispatch_unconfirmed",
              blockerCode: "WORKFLOW_DISPATCH_UNCONFIRMED",
              blockerMessage: message,
            })
            .where(eq(executions.id, executionId));
          await tx.insert(executionEvents).values({
            executionId,
            sequence: await nextExecutionSequence(tx, executionId),
            type: "workflow_dispatch_unconfirmed",
            stage: "preparando_ambiente",
            message,
            payload: { checkpointId: intent.id },
          });
        }
        return { workflowKnown: false };
      });
    },
  };
}
