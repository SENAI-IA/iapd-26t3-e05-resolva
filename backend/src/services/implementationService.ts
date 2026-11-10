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
      await assertGithubAvailability();
      const { id } = await repository.reserve(input, environment);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
