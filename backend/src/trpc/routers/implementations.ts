import {
  implementationQueueInputSchema,
  implementationQueueResultSchema,
  startImplementationResultSchema,
  startImplementationSchema,
} from "../../domain/implementationContracts.js";
import { implementationProcedure, router } from "../core.js";

export const implementationsRouter = router({
  queue: implementationProcedure
    .input(implementationQueueInputSchema.optional())
    .output(implementationQueueResultSchema)
    .query(({ ctx, input }) => ctx.implementations.queue(input)),
  start: implementationProcedure
    .input(startImplementationSchema)
    .output(startImplementationResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.start(input)),
});
