import { z } from "zod";
import { GithubCliError, type GithubClient } from "../integrations/github/cli.js";
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
    async start(input: StartImplementationInput) {
      const { id, reservation } = await repository.reserve(input, environment);
      if (reservation) await dispatchWorkflow(reservation);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
