import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { executions, executionEvents, tickets, ticketEvents } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import {
  assertWorkflowMatchesDispatch,
  dispatchReconciliationInputSchema,
  type DispatchReconciliationInput,
  type DispatchReconciliationResult,
} from "../domain/implementationDispatch.js";
import type { GithubWorkflowRun } from "../integrations/github/inspection.js";
import { workflowDispatchConstraints } from "./implementationDispatchRepository.js";
import {
  nextExecutionSequence,
  type ImplementationTransaction,
} from "./implementationTransactions.js";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function lockedContext(tx: ImplementationTransaction, input: DispatchReconciliationInput) {
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
      "O histórico possui workflows divergentes e exige intervenção.",
    );
  if (row.execution.workflowId !== null && row.execution.workflowId !== input.workflowId)
    throw new DomainError("CONFLICT", "A execução já está vinculada a outro run da workflow.");
  const constraints = await workflowDispatchConstraints(tx, row.execution);
  if (!constraints)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A execução não possui um checkpoint de disparo válido.",
    );
  const observation = constraints.observation;
  if (row.execution.status !== "em_andamento") {
    if (
      row.execution.workflowId === input.workflowId &&
      observation &&
      ((row.execution.status === "falhou" && observation.result.observedStatus === "failure") ||
        (row.execution.status === "interrompida" &&
          observation.result.observedStatus === "cancelled"))
    )
      return { replay: true as const, result: { ...observation.result, applied: false } };
    throw new DomainError("CONFLICT", "A execução já foi finalizada. Consulte sua conclusão.");
  }
  if (row.execution.outcome === "pipeline_awaiting_confirmation")
    throw new DomainError(
      "CONFLICT",
      "A execução possui proposta de sucesso. Use a reconciliação da entrega.",
    );
  if (row.ticket.status !== "em_andamento" || row.ticket.version !== row.execution.ticketVersion)
    throw new DomainError("CONFLICT", "O ticket diverge da versão reservada para a execução.");
  return { replay: false as const, row, observation, context: constraints };
}

function observedStatus(run: GithubWorkflowRun): DispatchReconciliationResult["observedStatus"] {
  if (run.status !== "completed") return run.status === "in_progress" ? "running" : "queued";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "cancelled") return "cancelled";
  if (
    run.conclusion === "failure" ||
    run.conclusion === "timed_out" ||
    run.conclusion === "startup_failure"
  )
    return "failure";
  return "indeterminate";
}

export function createImplementationDispatchReconciliation(database: AppDatabase) {
  return {
    async prepareDispatchReconciliation(input: DispatchReconciliationInput) {
      const parsed = dispatchReconciliationInputSchema.parse(input);
      return database.db.transaction(async (tx) => {
        const state = await lockedContext(tx, parsed);
        return state.replay
          ? { replay: true as const, result: state.result }
          : { replay: false as const, context: state.context };
      });
    },
    async applyDispatchObservation(
      input: DispatchReconciliationInput,
      checkpointFingerprint: string,
      run: GithubWorkflowRun,
    ) {
      const parsed = dispatchReconciliationInputSchema.parse(input);
      return database.db.transaction(async (tx) => {
        const state = await lockedContext(tx, parsed);
        if (state.replay) return state.result;
        const { row, context } = state;
        if (context.checkpointFingerprint !== checkpointFingerprint || run.id !== parsed.workflowId)
          throw new DomainError(
            "CONFLICT",
            "A workflow remota não corresponde ao checkpoint da execução.",
          );
        assertWorkflowMatchesDispatch(context, run);
        if (state.observation && state.observation.workflowAttempt !== run.attempt)
          throw new DomainError(
            "CONFLICT",
            "A tentativa da workflow mudou. Revise a execução antes de reconciliar.",
          );
        const status = observedStatus(run);
        const workflowUrl = `https://github.com/${context.repository}/actions/runs/${run.id}`;
        const result: DispatchReconciliationResult = {
          applied: true,
          workflowId: run.id,
          workflowUrl,
          observedStatus: status,
        };
        const observationFingerprint = fingerprint({ checkpointFingerprint, run });
        const [replay] = await tx
          .select({ id: executionEvents.id })
          .from(executionEvents)
          .where(
            and(
              eq(executionEvents.executionId, row.execution.id),
              eq(executionEvents.type, "workflow_dispatch_reconciled"),
              sql`${executionEvents.payload}->>'fingerprint' = ${observationFingerprint}`,
            ),
          )
          .limit(1);
        if (replay) return { ...result, applied: false };
        if (
          (row.execution.outcome === "pipeline_running" && status === "queued") ||
          (row.execution.outcome === "pipeline_awaiting_report" &&
            status !== "success" &&
            status !== "indeterminate")
        )
          throw new DomainError(
            "CONFLICT",
            "A observação remota não pode regredir o progresso confirmado.",
          );
        const terminal = status === "failure" || status === "cancelled";
        const message = terminal
          ? "A workflow terminou sem concluir a implementação, conforme consulta ao GitHub."
          : "Workflow vinculada por consulta autenticada ao GitHub.";
        await tx
          .update(executions)
          .set({
            workflowId: run.id,
            workflowUrl,
            status:
              status === "failure"
                ? "falhou"
                : status === "cancelled"
                  ? "interrompida"
                  : "em_andamento",
            outcome:
              status === "success" || status === "indeterminate"
                ? "pipeline_awaiting_report"
                : `pipeline_${status}`,
            stage:
              status === "success" || status === "indeterminate"
                ? "validando"
                : row.execution.stage,
            blockerCode: terminal ? "PIPELINE_FAILED" : null,
            blockerMessage: terminal ? message : null,
            completedAt: terminal ? sql`clock_timestamp()` : null,
          })
          .where(eq(executions.id, row.execution.id));
        if (terminal) {
          await tx
            .update(tickets)
            .set({ status: "aberto", updatedAt: sql`clock_timestamp()` })
            .where(eq(tickets.id, row.ticket.id));
          await tx.insert(ticketEvents).values({
            ticketId: row.ticket.id,
            type: "implementation_failed",
            fromStatus: row.ticket.status,
            toStatus: "aberto",
            message,
            payload: {
              executionId: row.execution.id,
              workflowId: run.id,
              source: "github_reconciliation",
            },
            createdAt: sql`clock_timestamp()`,
          });
        }
        await tx.insert(executionEvents).values({
          executionId: row.execution.id,
          sequence: await nextExecutionSequence(tx, row.execution.id),
          type: "workflow_dispatch_reconciled",
          stage: row.execution.stage,
          message,
          payload: { fingerprint: observationFingerprint, workflowAttempt: run.attempt, result },
        });
        return result;
      });
    },
  };
}
