import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/index.js";
import { artifacts, deliveries, executions, executionEvents } from "../db/schema.js";
import { DomainError } from "../domain/error.js";
import {
  evidenceFingerprint,
  implementationEvidenceSchema,
} from "../domain/implementationEvidence.js";
import { nextExecutionSequence, validationEvent } from "./implementationTransactions.js";
import { workflowDispatchConstraints } from "./implementationDispatchRepository.js";
import { assertEvidenceMatchesDispatch } from "../domain/implementationDispatch.js";

export function createImplementationEvidenceRepository(database: AppDatabase) {
  return {
    async recordValidationEvidence(input: unknown) {
      const result = implementationEvidenceSchema.safeParse(input);
      if (!result.success)
        throw new DomainError("BAD_REQUEST", "Evidência de implementação inválida.");
      const evidence = result.data;
      const fingerprint = evidenceFingerprint(evidence);
      return database.db.transaction(async (tx) => {
        const [execution] = await tx
          .select()
          .from(executions)
          .where(
            and(eq(executions.id, evidence.executionId), eq(executions.kind, "implementation")),
          )
          .for("update");
        if (!execution)
          throw new DomainError("NOT_FOUND", "Execução de implementação não encontrada.");
        const previous = await validationEvent(tx, execution.id);
        if (previous) {
          if (previous.payload.fingerprint === fingerprint) return { applied: false, fingerprint };
          throw new DomainError("CONFLICT", "A execução já possui outra evidência aprovada.");
        }
        if (execution.status !== "em_andamento")
          throw new DomainError("CONFLICT", "A execução não está ativa para aprovar evidências.");
        if (
          execution.deliveryId !== evidence.deliveryId ||
          execution.workflowId !== evidence.workflowId ||
          execution.ticketSnapshot.classification !== evidence.classification
        )
          throw new DomainError("CONFLICT", "A evidência pertence a outra entrega ou workflow.");
        assertEvidenceMatchesDispatch(evidence, await workflowDispatchConstraints(tx, execution));
        const [delivery] = await tx
          .select()
          .from(deliveries)
          .where(eq(deliveries.id, evidence.deliveryId))
          .for("update");
        const paths = z.array(z.string().min(1)).safeParse(execution.configSnapshot.testPaths);
        if (
          !delivery ||
          delivery.ticketId !== execution.ticketId ||
          !paths.success ||
          !paths.data.some((path) => evidence.test.path.startsWith(`${path}/`))
        )
          throw new DomainError(
            "PRECONDITION_FAILED",
            "A evidência não corresponde aos testes da execução.",
          );
        await tx.insert(artifacts).values({
          executionId: execution.id,
          kind: "validation_report",
          contentType: "application/json",
          ...evidence.report,
        });
        await tx
          .update(executions)
          .set({ validatedSha: evidence.commitSha })
          .where(eq(executions.id, execution.id));
        await tx.insert(executionEvents).values({
          executionId: execution.id,
          sequence: await nextExecutionSequence(tx, execution.id),
          type: "validation_approved",
          stage: "validando",
          message: "Evidências de implementação aprovadas pelo executor.",
          payload: { fingerprint, evidence },
        });
        return { applied: true, fingerprint };
      });
    },
  };
}
