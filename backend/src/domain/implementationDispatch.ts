import { z } from "zod";
import { DomainError } from "./error.js";
import type { GithubWorkflowRun } from "../integrations/github/inspection.js";
import { sameRepository } from "../integrations/github/contracts.js";
import {
  githubBranchSchema,
  githubRepositorySchema,
  githubRunIdSchema,
  githubWorkflowFileSchema,
  githubWorkflowSelectorSchema,
} from "../integrations/github/contracts.js";

export const dispatchConfigSchema = z.object({
  repository: githubRepositorySchema,
  baseBranch: githubBranchSchema,
  workflowRef: githubWorkflowSelectorSchema,
});
export const dispatchCheckpointSchema = z.strictObject({
  repository: githubRepositorySchema,
  baseBranch: githubBranchSchema,
  workflowSelector: githubWorkflowSelectorSchema,
  workflowDefinitionId: githubRunIdSchema,
  workflowPath: githubWorkflowFileSchema,
});
export const dispatchReconciliationInputSchema = z.strictObject({
  executionId: z.uuid(),
  workflowId: githubRunIdSchema,
});
export type DispatchReconciliationInput = z.infer<typeof dispatchReconciliationInputSchema>;
export const dispatchReconciliationResultSchema = z.strictObject({
  applied: z.boolean(),
  workflowId: githubRunIdSchema,
  workflowUrl: z.url(),
  observedStatus: z.enum(["queued", "running", "success", "failure", "cancelled", "indeterminate"]),
});
export type DispatchReconciliationResult = z.infer<typeof dispatchReconciliationResultSchema>;

export function assertWorkflowMatchesDispatch(
  context: {
    executionId: string;
    repository: string;
    baseBranch: string;
    workflowDefinitionId: string;
    requestedAt: string;
  },
  run: GithubWorkflowRun,
) {
  const createdAt = Date.parse(run.createdAt);
  if (
    !sameRepository(run.repository, context.repository) ||
    run.workflowDefinitionId !== context.workflowDefinitionId ||
    run.headBranch !== context.baseBranch ||
    run.event !== "workflow_dispatch" ||
    run.displayTitle !== `Resolva ${context.executionId}` ||
    !Number.isFinite(createdAt) ||
    createdAt < Math.floor(Date.parse(context.requestedAt) / 1000) * 1000 ||
    createdAt > Date.now() + 60_000
  )
    throw new DomainError(
      "CONFLICT",
      "A workflow remota não corresponde ao checkpoint da execução.",
    );
}

export function assertEvidenceMatchesDispatch(
  evidence: { workflowDefinitionId: string; workflowAttempt: number },
  dispatch: {
    workflowDefinitionId: string;
    observation: { workflowAttempt: number } | null;
  } | null,
) {
  if (
    dispatch &&
    (evidence.workflowDefinitionId !== dispatch.workflowDefinitionId ||
      (dispatch.observation !== null &&
        evidence.workflowAttempt !== dispatch.observation.workflowAttempt))
  )
    throw new DomainError(
      "CONFLICT",
      "A evidência diverge da definição ou tentativa registrada no disparo.",
    );
}
