import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/index.js";
import { deliveries, executions, tickets } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import { projectConfigSchema, createTargetSystemSnapshot } from "../config/project.js";
import {
  implementationEvidenceSchema,
  evidenceFingerprint,
} from "../domain/implementationEvidence.js";
import { workflowDispatchConstraints } from "./implementationDispatchRepository.js";
import { validationEvent, type ImplementationTransaction } from "./implementationTransactions.js";

const triageSchema = z.object({
  id: z.uuid(),
  classification: z.enum(["bug", "melhoria"]),
  acceptanceCriteria: z.array(z.string()),
});

export async function pipelineReportCollectionState(
  tx: ImplementationTransaction,
  executionId: string,
) {
  const [row] = await tx
    .select({ execution: executions, ticket: tickets })
    .from(executions)
    .innerJoin(tickets, eq(tickets.id, executions.ticketId))
    .where(and(eq(executions.id, executionId), eq(executions.kind, "implementation")))
    .for("update");
  if (!row) throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
  const dispatch = await workflowDispatchConstraints(tx, row.execution);
  if (!dispatch || row.execution.workflowId === null || row.execution.deliveryId === null)
    throw new DomainError(
      "PRECONDITION_FAILED",
      "Vincule a workflow ao checkpoint antes de coletar o relatório.",
    );
  const previous = await validationEvent(tx, row.execution.id);
  const cached = previous
    ? implementationEvidenceSchema.safeParse(previous.payload.evidence)
    : null;
  if (
    previous &&
    (!cached?.success || evidenceFingerprint(cached.data) !== previous.payload.fingerprint)
  )
    throw new DomainError("PRECONDITION_FAILED", "A evidência aprovada está inválida.");
  if (row.execution.status === "concluida" && cached?.success) return { replay: true as const };
  if (
    row.execution.status !== "em_andamento" ||
    row.ticket.status !== "em_andamento" ||
    row.ticket.version !== row.execution.ticketVersion ||
    row.ticket.currentTriageId !== row.execution.triageId
  )
    throw new DomainError(
      "CONFLICT",
      "A execução não está ativa na versão esperada para coletar evidências.",
    );
  const [delivery] = await tx
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, row.execution.deliveryId))
    .for("update");
  const { snapshotHash, ...rawConfig } = row.execution.configSnapshot;
  const config = projectConfigSchema.safeParse(rawConfig);
  const triage = triageSchema.safeParse(row.execution.ticketSnapshot.triage);
  if (
    !delivery ||
    delivery.ticketId !== row.execution.ticketId ||
    !config.success ||
    typeof snapshotHash !== "string" ||
    createTargetSystemSnapshot(config.data).snapshotHash !== snapshotHash ||
    !triage.success ||
    triage.data.id !== row.execution.triageId ||
    triage.data.classification !== row.execution.ticketSnapshot.classification ||
    row.ticket.classification !== triage.data.classification ||
    delivery.repository !== config.data.repository ||
    delivery.baseBranch !== config.data.baseBranch
  )
    throw new DomainError(
      "PRECONDITION_FAILED",
      "A configuração ou triagem reservada não permite coletar o relatório.",
    );
  const context = {
    executionId: row.execution.id,
    deliveryId: delivery.id,
    ticketId: row.execution.ticketId,
    ticketVersion: row.execution.ticketVersion,
    triageId: triage.data.id,
    configHash: snapshotHash,
    repository: delivery.repository,
    branchName: delivery.branchName,
    workflowId: row.execution.workflowId,
    workflowDefinitionId: dispatch.workflowDefinitionId,
    classification: triage.data.classification,
    acceptanceCriteria: triage.data.acceptanceCriteria,
    testPaths: config.data.testPaths,
    allowedPaths: config.data.allowedPaths,
    documentationPaths: config.data.documentationPaths,
    maxRounds: config.data.maxRounds,
    artifactRoot: config.data.artifactRoot,
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        context,
        configSnapshot: row.execution.configSnapshot,
        ticketSnapshot: row.execution.ticketSnapshot,
        dispatchFingerprint: dispatch.checkpointFingerprint,
        observedAttempt: dispatch.observation?.workflowAttempt ?? null,
      }),
    )
    .digest("hex");
  return {
    replay: false as const,
    context,
    dispatch,
    fingerprint,
    cached: cached?.success ? cached.data : null,
  };
}

export function createImplementationReportRepository(database: AppDatabase) {
  return {
    prepareReportCollection(executionId: string) {
      return database.db.transaction((tx) => pipelineReportCollectionState(tx, executionId));
    },
  };
}
