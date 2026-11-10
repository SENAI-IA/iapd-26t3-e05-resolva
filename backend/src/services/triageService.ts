import {
  listTriagesSchema,
  type ListTriagesInput,
  type StartTriageInput,
} from "../domain/triageContracts.js";
import type { TriageRepository } from "../repository/triageRepository.js";

type Reservation = NonNullable<Awaited<ReturnType<TriageRepository["reserve"]>>["reservation"]>;
type TriageRunner = (reservation: Reservation) => Promise<unknown>;

export function createTriageService(repository: TriageRepository, run?: TriageRunner) {
  const jobs = new Set<Promise<void>>();

  async function execute(reservation: Reservation, runner: TriageRunner) {
    try {
      await repository.complete(reservation.executionId, await runner(reservation));
    } catch {
      try {
        await repository.fail(reservation.executionId);
      } catch {
        console.error("Não foi possível registrar a falha da triagem no banco.");
      }
    }
  }

  return {
    async start(input: StartTriageInput) {
      const { id, reservation } = await repository.reserve(input, run !== undefined);
      if (reservation && run) {
        const job = execute(reservation, run);
        jobs.add(job);
        void job.then(() => jobs.delete(job));
      }
      return { triageExecutionId: id };
    },
    byId: repository.byId,
    list: (input?: ListTriagesInput) => repository.list(input ?? listTriagesSchema.parse({})),
    async drain() {
      await Promise.all(jobs);
    },
  };
}

export type TriageService = ReturnType<typeof createTriageService>;
