import {
  listTriagesSchema,
  startTriageResultSchema,
  startTriageSchema,
  triageDetailSchema,
  triageIdentitySchema,
  triageListSchema,
} from "../../domain/triageContracts.js";
import { router, triageProcedure } from "../core.js";

export const triagesRouter = router({
  start: triageProcedure
    .input(startTriageSchema)
    .output(startTriageResultSchema)
    .mutation(({ ctx, input }) => ctx.triages.start(input)),
  byId: triageProcedure
    .input(triageIdentitySchema)
    .output(triageDetailSchema)
    .query(({ ctx, input }) => ctx.triages.byId(input.triageId)),
  list: triageProcedure
    .input(listTriagesSchema.optional())
    .output(triageListSchema)
    .query(({ ctx, input }) => ctx.triages.list(input)),
});
