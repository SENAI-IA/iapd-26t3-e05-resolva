import { and, eq, sql } from "drizzle-orm";
import { executions, tickets, executionEvents } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import {
  parsePipelineCallback,
  pipelineCallbackSchema,
  pipelineCallbackFingerprint,
  type PipelineCallback,
} from "../integrations/ci/callback.js";
import type { ImplementationTransaction } from "./implementationTransactions.js";

export async function lockPipelineCallback(tx: ImplementationTransaction, input: PipelineCallback) {
  const [row] = await tx
    .select({ execution: executions, ticket: tickets })
    .from(executions)
    .innerJoin(tickets, eq(tickets.id, executions.ticketId))
    .where(and(eq(executions.id, input.executionId), eq(executions.kind, "implementation")))
    .for("update");
  if (!row) throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
  if (row.execution.blockerCode === "WORKFLOW_IDENTITY_CONFLICT")
    throw new DomainError(
      "PRECONDITION_FAILED",
      "O histórico contém workflows divergentes. Reconcilie a execução antes de receber novos callbacks.",
    );
  const repository = pipelineCallbackSchema.shape.repository.safeParse(
    row.execution.configSnapshot.repository,
  );
  if (!repository.success)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A configuração da execução não identifica um repositório válido.",
    );
  let callback: PipelineCallback;
  try {
    callback = parsePipelineCallback(input, {
      executionId: row.execution.id,
      repository: repository.data,
    });
  } catch {
    throw new DomainError("BAD_REQUEST", "Callback da pipeline inválido.");
  }
  if (
    (row.execution.workflowId !== null && row.execution.workflowId !== callback.workflowId) ||
    (row.execution.workflowUrl !== null && row.execution.workflowUrl !== callback.workflowUrl)
  )
    throw new DomainError("CONFLICT", "O callback pertence a outro workflow.");
  const fingerprint = pipelineCallbackFingerprint(callback);
  const [event] = await tx
    .select({ id: executionEvents.id })
    .from(executionEvents)
    .where(
      and(
        eq(executionEvents.executionId, callback.executionId),
        eq(executionEvents.type, "pipeline_callback"),
        sql`${executionEvents.payload}->>'fingerprint' = ${fingerprint}`,
      ),
    )
    .limit(1);
  if (!event) {
    if (row.execution.status !== "em_andamento")
      throw new DomainError("CONFLICT", "A execução já foi finalizada e recebeu outro callback.");
    if (
      (row.execution.outcome === "pipeline_running" && callback.status === "queued") ||
      (["pipeline_awaiting_confirmation", "pipeline_awaiting_report"].includes(
        row.execution.outcome ?? "",
      ) &&
        callback.status !== "success")
    )
      throw new DomainError("CONFLICT", "O callback não pode regredir o estado da pipeline.");
  }
  return { row, callback, fingerprint, replay: Boolean(event) };
}
export type PipelineCallbackRow = Awaited<ReturnType<typeof lockPipelineCallback>>["row"];
