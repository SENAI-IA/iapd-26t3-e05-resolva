import {
  implementationArtifactIdentitySchema,
  implementationArtifactResultSchema,
  implementationDetailSchema,
  implementationEventsInputSchema,
  implementationEventsSchema,
  implementationIdentitySchema,
  implementationListInputSchema,
  implementationListSchema,
} from "../../domain/implementationContracts.js";
import { implementationProcedure, router } from "../core.js";

export const executionsRouter = router({
  list: implementationProcedure
    .input(implementationListInputSchema.optional())
    .output(implementationListSchema)
    .query(({ ctx, input }) => ctx.implementations.list(input)),
  byId: implementationProcedure
    .input(implementationIdentitySchema)
    .output(implementationDetailSchema)
    .query(({ ctx, input }) => ctx.implementations.byId(input.executionId)),
  events: implementationProcedure
    .input(implementationEventsInputSchema)
    .output(implementationEventsSchema)
    .query(({ ctx, input }) => ctx.implementations.events(input)),
  artifact: implementationProcedure
    .input(implementationArtifactIdentitySchema)
    .output(implementationArtifactResultSchema)
    .query(({ ctx, input }) => ctx.implementations.artifact(input.executionId, input.artifactId)),
});
