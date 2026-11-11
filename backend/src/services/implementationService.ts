import { z } from "zod";
import { GithubCliError, type GithubClient } from "../integrations/github/cli.js";
import { DeliveryConfirmationError } from "../integrations/github/confirmation.js";
import type { PipelineCallback } from "../integrations/ci/callback.js";
import { DomainError } from "../domain/error.js";
import type { ImplementationEnvironment } from "../domain/contracts.js";
import {
  implementationListInputSchema,
  implementationQueueInputSchema,
  type ImplementationListInput,
  type ImplementationQueueInput,
  type StartImplementationInput,
} from "../domain/implementationContracts.js";
import type { ImplementationRepository } from "../repository/implementationRepository.js";

const workflowConfigSchema = z.object({
  repository: z.string().min(1),
  workflowRef: z.string().min(1),
  baseBranch: z.string().min(1),
});

export function createImplementationService(
  repository: ImplementationRepository,
  environment: Pick<ImplementationEnvironment, "ready" | "sourceHashes">,
  github?: GithubClient,
) {
  async function applyCallback(callback: PipelineCallback) {
    if (callback.status !== "success") return repository.applyPipelineCallback(callback);
    const proposal = await repository.registerSuccessProposal(callback);
    if (proposal.replay) return proposal.result;
    const context = await repository.prepareSuccessConfirmation(callback);
    if (context.replay) return context.result;
    if (!github)
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Configure o GitHub para confirmar a entrega da implementação.",
      );
    let delivery;
    try {
      const workflow = await github.getWorkflowRun({
        repository: context.expected.repository,
        workflowId: callback.workflowId,
      });
      if (
        workflow.status !== "completed" ||
        workflow.conclusion !== "success" ||
        workflow.event !== "workflow_dispatch" ||
        workflow.attempt !== context.workflowAttempt ||
        workflow.workflowDefinitionId !== context.workflowDefinitionId ||
        workflow.headBranch !== context.expected.baseBranch
      )
        throw new DomainError("CONFLICT", "A workflow remota diverge da evidência aprovada.");
      delivery = await github.confirmDelivery(context.expected);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof DeliveryConfirmationError)
        throw new DomainError("CONFLICT", error.message);
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Não foi possível confirmar a execução no GitHub. A implementação permanece ativa para reconciliação.",
      );
    }
    return repository.applyPipelineCallback(callback, {
      callbackFingerprint: context.callbackFingerprint,
      validationFingerprint: context.validationFingerprint,
      workflowId: callback.workflowId,
      workflowDefinitionId: context.workflowDefinitionId,
      workflowAttempt: context.workflowAttempt,
      delivery,
    });
  }

  async function assertGithubAvailability() {
    if (!github) return;
    try {
      const availability = await github.checkAvailability();
      if (!availability.installed)
        throw new Error("Instale o GitHub CLI (gh) na máquina da aplicação.");
      if (!availability.authenticated)
        throw new Error("Autentique o GitHub CLI (gh) na máquina da aplicação.");
    } catch (error) {
      if (error instanceof GithubCliError || error instanceof Error)
        throw new DomainError("PRECONDITION_FAILED", error.message);
      throw new DomainError("PRECONDITION_FAILED", "Não foi possível validar o GitHub CLI.");
    }
  }

  async function dispatchWorkflow(
    reservation: NonNullable<
      Awaited<ReturnType<ImplementationRepository["reserve"]>>["reservation"]
    >,
  ) {
    if (!github) return;
    const config = workflowConfigSchema.safeParse(reservation.configSnapshot);
    if (!config.success) {
      await repository.blockWorkflowDispatch(reservation.executionId);
      throw new DomainError(
        "PRECONDITION_FAILED",
        "A configuração da execução não pode disparar a workflow.",
      );
    }
    try {
      await assertGithubAvailability();
      await github.triggerWorkflow({
        repository: config.data.repository,
        workflow: config.data.workflowRef,
        ref: config.data.baseBranch,
        fields: {
          executionId: reservation.executionId,
          ticketId: String(reservation.ticketId),
          ticketVersion: String(reservation.ticketSnapshot.version),
          deliveryId: reservation.deliveryId,
          branchName: reservation.branchName,
        },
      });
      await repository.markWorkflowDispatched(reservation.executionId);
    } catch (error) {
      await repository.blockWorkflowDispatch(reservation.executionId);
      if (error instanceof DomainError) throw error;
      if (error instanceof GithubCliError || error instanceof Error)
        throw new DomainError("PRECONDITION_FAILED", error.message);
      throw new DomainError("PRECONDITION_FAILED", "Não foi possível disparar a workflow.");
    }
  }

  return {
    queue(input?: ImplementationQueueInput) {
      return repository.queue(input ?? implementationQueueInputSchema.parse({}), environment);
    },
    list(input?: ImplementationListInput) {
      return repository.list(input ?? implementationListInputSchema.parse({}));
    },
    byId(executionId: string) {
      return repository.byId(executionId);
    },
    applyCallback,
    async reconcile(executionId: string) {
      return applyCallback(await repository.pendingSuccessCallback(executionId));
    },
    async start(input: StartImplementationInput) {
      const { id, reservation } = await repository.reserve(input, environment);
      if (reservation) await dispatchWorkflow(reservation);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
