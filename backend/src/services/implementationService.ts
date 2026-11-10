import type { ImplementationEnvironment } from "../domain/contracts.js";
import {
  implementationQueueInputSchema,
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
    async start(input: StartImplementationInput) {
      const { id } = await repository.reserve(input, environment);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
