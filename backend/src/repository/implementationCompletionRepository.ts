import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/index.js";
import { artifacts, deliveries, executions, executionEvents } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import {
  implementationEvidenceSchema,
  evidenceFingerprint,
} from "../domain/implementationEvidence.js";
import { pipelineCallbackSchema, type PipelineCallback } from "../integrations/ci/callback.js";
import {
  githubBranchSchema,
  githubRepositorySchema,
  sameRepository,
} from "../integrations/github/contracts.js";
import type { confirmDelivery } from "../integrations/github/confirmation.js";
import { lockPipelineCallback, type PipelineCallbackRow } from "./implementationCallback.js";
import { workflowDispatchConstraints } from "./implementationDispatchRepository.js";
import { assertEvidenceMatchesDispatch } from "../domain/implementationDispatch.js";
import {
  nextExecutionSequence,
  validationEvent,
  type ImplementationTransaction,
} from "./implementationTransactions.js";

const configSchema = z.object({
  repository: githubRepositorySchema,
  baseBranch: githubBranchSchema,
});
export type PipelineSuccessProof = {
  callbackFingerprint: string;
  validationFingerprint: string;
  dispatchFingerprint: string | null;
  workflowId: string;
  workflowDefinitionId: string;
  workflowAttempt: number;
  delivery: Awaited<ReturnType<typeof confirmDelivery>>;
};

async function successDelivery(
  tx: ImplementationTransaction,
  row: PipelineCallbackRow,
  callback: PipelineCallback,
) {
  const config = configSchema.safeParse(row.execution.configSnapshot);
  if (!config.success || !row.execution.deliveryId)
    throw new DomainError("PRECONDITION_FAILED", "A execução não possui uma entrega configurada.");
  const [delivery] = await tx
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, row.execution.deliveryId))
    .for("update");
  if (
    !delivery ||
    delivery.ticketId !== row.execution.ticketId ||
    !sameRepository(delivery.repository, config.data.repository) ||
    delivery.baseBranch !== config.data.baseBranch ||
    delivery.branchName !== callback.branch ||
    (delivery.prNumber !== null && delivery.prNumber !== callback.pullRequest?.number)
  )
    throw new DomainError("CONFLICT", "O callback diverge da entrega reservada.");
  return delivery;
}

export async function pipelineSuccessContext(
  tx: ImplementationTransaction,
  row: PipelineCallbackRow,
  callback: PipelineCallback,
) {
  const delivery = await successDelivery(tx, row, callback);
  const event = await validationEvent(tx, row.execution.id);
  const parsed = implementationEvidenceSchema.safeParse(event?.payload.evidence);
  if (!parsed.success)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A execução ainda não possui evidências aprovadas pelo executor.",
    );
  const evidence = parsed.data;
  const dispatch = await workflowDispatchConstraints(tx, row.execution);
  assertEvidenceMatchesDispatch(evidence, dispatch);
  const fingerprint = evidenceFingerprint(evidence);
  if (
    event?.payload.fingerprint !== fingerprint ||
    evidence.executionId !== row.execution.id ||
    evidence.deliveryId !== delivery.id ||
    evidence.workflowId !== callback.workflowId ||
    evidence.commitSha !== callback.commitSha ||
    row.execution.validatedSha !== evidence.commitSha ||
    row.ticket.version !== row.execution.ticketVersion ||
    row.ticket.status !== "em_andamento"
  )
    throw new DomainError(
      "CONFLICT",
      "A evidência aprovada ou a versão da execução diverge do callback.",
    );
  const [artifact] = await tx
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.executionId, row.execution.id),
        eq(artifacts.kind, "validation_report"),
        eq(artifacts.relativePath, evidence.report.relativePath),
        eq(artifacts.sha256, evidence.report.sha256),
        eq(artifacts.sizeBytes, evidence.report.sizeBytes),
      ),
    )
    .limit(1);
  if (!artifact)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "O registro do relatório de validação está indisponível.",
    );
  if (!callback.pullRequest) throw new DomainError("BAD_REQUEST", "Callback da pipeline inválido.");
  return {
    expected: {
      repository: delivery.repository,
      deliveryId: delivery.id,
      branch: delivery.branchName,
      baseBranch: delivery.baseBranch,
      validatedSha: evidence.commitSha,
      prNumber: callback.pullRequest.number,
    },
    validationFingerprint: fingerprint,
    dispatch,
    workflowDefinitionId: evidence.workflowDefinitionId,
    workflowAttempt: evidence.workflowAttempt,
  };
}

export async function confirmPipelineDelivery(
  tx: ImplementationTransaction,
  row: PipelineCallbackRow,
  callback: PipelineCallback,
  fingerprint: string,
  proof?: PipelineSuccessProof,
) {
  if (!proof)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A conclusão exige evidências aprovadas e confirmação remota.",
    );
  const context = await pipelineSuccessContext(tx, row, callback);
  const expected = context.expected;
  if (
    proof.callbackFingerprint !== fingerprint ||
    proof.validationFingerprint !== context.validationFingerprint ||
    proof.dispatchFingerprint !== (context.dispatch?.checkpointFingerprint ?? null) ||
    proof.workflowId !== callback.workflowId ||
    proof.workflowDefinitionId !== context.workflowDefinitionId ||
    proof.workflowAttempt !== context.workflowAttempt ||
    proof.delivery.deliveryId !== expected.deliveryId ||
    !sameRepository(proof.delivery.repository, expected.repository) ||
    proof.delivery.branchName !== expected.branch ||
    proof.delivery.baseBranch !== expected.baseBranch ||
    proof.delivery.validatedSha !== expected.validatedSha ||
    proof.delivery.remoteHeadSha !== expected.validatedSha ||
    proof.delivery.prNumber !== expected.prNumber ||
    proof.delivery.prState !== "OPEN"
  )
    throw new DomainError(
      "CONFLICT",
      "A confirmação remota ficou desatualizada para esta execução.",
    );
  const url = new URL(proof.delivery.prUrl);
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !== `/${expected.repository}/pull/${expected.prNumber}`.toLowerCase()
  )
    throw new DomainError(
      "CONFLICT",
      "A confirmação remota não identifica a Pull Request da entrega.",
    );
  await tx
    .update(deliveries)
    .set({
      prNumber: proof.delivery.prNumber,
      prUrl: proof.delivery.prUrl,
      prState: proof.delivery.prState,
      remoteHeadSha: proof.delivery.remoteHeadSha,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(deliveries.id, expected.deliveryId));
}

export function createImplementationCompletionRepository(database: AppDatabase) {
  return {
    async registerSuccessProposal(input: PipelineCallback) {
      return database.db.transaction(async (tx) => {
        const locked = await lockPipelineCallback(tx, input);
        const { row, callback, fingerprint, replay } = locked;
        if (replay) return { replay: true as const, result: { applied: false, fingerprint } };
        if (callback.status !== "success")
          throw new DomainError("BAD_REQUEST", "A proposta não informa sucesso da pipeline.");
        await successDelivery(tx, row, callback);
        const [existing] = await tx
          .select({ id: executionEvents.id })
          .from(executionEvents)
          .where(
            and(
              eq(executionEvents.executionId, callback.executionId),
              eq(executionEvents.type, "pipeline_success_reported"),
              sql`${executionEvents.payload}->>'fingerprint' = ${fingerprint}`,
            ),
          )
          .limit(1);
        if (!existing) {
          await tx
            .update(executions)
            .set({
              workflowId: callback.workflowId,
              workflowUrl: callback.workflowUrl,
              outcome: "pipeline_awaiting_confirmation",
              stage: "validando",
            })
            .where(eq(executions.id, callback.executionId));
          await tx.insert(executionEvents).values({
            executionId: callback.executionId,
            sequence: await nextExecutionSequence(tx, callback.executionId),
            type: "pipeline_success_reported",
            stage: "validando",
            message: "Sucesso informado; aguardando evidências e confirmação remota.",
            payload: { fingerprint, callback },
          });
        }
        return { replay: false as const };
      });
    },
    async prepareSuccessConfirmation(input: PipelineCallback) {
      return database.db.transaction(async (tx) => {
        const { row, callback, fingerprint, replay } = await lockPipelineCallback(tx, input);
        if (replay) return { replay: true as const, result: { applied: false, fingerprint } };
        const context = await pipelineSuccessContext(tx, row, callback);
        return { replay: false as const, ...context, callbackFingerprint: fingerprint };
      });
    },
    async pendingSuccessCallback(executionId: string) {
      return database.db.transaction(async (tx) => {
        const [execution] = await tx
          .select()
          .from(executions)
          .where(and(eq(executions.id, executionId), eq(executions.kind, "implementation")))
          .for("update");
        if (!execution)
          throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        const conditions = [
          eq(executionEvents.executionId, executionId),
          eq(executionEvents.type, "pipeline_success_reported"),
        ];
        if (execution.status === "concluida") {
          const [completed] = await tx
            .select({ payload: executionEvents.payload })
            .from(executionEvents)
            .where(
              and(
                eq(executionEvents.executionId, executionId),
                eq(executionEvents.type, "pipeline_callback"),
                sql`${executionEvents.payload}->>'status' = 'success'`,
              ),
            )
            .orderBy(desc(executionEvents.sequence))
            .limit(1);
          if (typeof completed?.payload.fingerprint !== "string")
            throw new DomainError(
              "PRECONDITION_FAILED",
              "A conclusão não possui uma proposta confirmada para reconciliar.",
            );
          conditions.push(
            sql`${executionEvents.payload}->>'fingerprint' = ${completed.payload.fingerprint}`,
          );
        } else if (execution.validatedSha !== null) {
          conditions.push(
            sql`${executionEvents.payload}->'callback'->>'commitSha' = ${execution.validatedSha}`,
          );
        }
        const [event] = await tx
          .select({ payload: executionEvents.payload })
          .from(executionEvents)
          .where(and(...conditions))
          .orderBy(desc(executionEvents.sequence))
          .limit(1);
        const parsed = pipelineCallbackSchema.safeParse(event?.payload.callback);
        if (
          !parsed.success ||
          parsed.data.status !== "success" ||
          parsed.data.executionId !== executionId
        )
          throw new DomainError(
            "PRECONDITION_FAILED",
            "A execução ainda não possui uma proposta de sucesso compatível para reconciliar.",
          );
        return parsed.data;
      });
    },
  };
}
