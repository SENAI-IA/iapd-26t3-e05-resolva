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
) {
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
      const { id } = await repository.reserve(input, environment);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
