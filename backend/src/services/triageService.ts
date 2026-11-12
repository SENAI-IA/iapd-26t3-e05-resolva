import { type InstanceGuard } from "../executor/instanceGuard.js";
import { DomainError } from "../domain/error.js";
import {
  listTriagesSchema,
  type ListTriagesInput,
  type StartTriageInput,
} from "../domain/triageContracts.js";
import type { TriageRepository } from "../repository/triageRepository.js";

type Reservation = NonNullable<Awaited<ReturnType<TriageRepository["reserve"]>>["reservation"]>;
export type TriageReservation = Reservation;
export type TriageRunner = (reservation: Reservation) => Promise<unknown>;

export function createTriageService(
  repository: TriageRepository,
  run?: TriageRunner,
  instanceGuard?: Pick<InstanceGuard, "assertOwned">,
) {
  const jobs = new Set<Promise<void>>();

  async function assertInstanceOwned() {
    try {
      await instanceGuard?.assertOwned();
    } catch {
      throw new DomainError("PRECONDITION_FAILED", "A instância perdeu a posse do processamento.");
    }
  }

  async function execute(reservation: Reservation, runner: TriageRunner) {
    try {
      await assertInstanceOwned();
      const report = await runner(reservation);
      await assertInstanceOwned();
      await repository.complete(reservation.executionId, report);
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
      await assertInstanceOwned();
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
