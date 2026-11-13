import { z } from "zod";
import {
  implementationIdentitySchema,
  implementationListInputSchema,
  implementationListSchema,
  implementationDetailSchema,
  implementationArtifactIdentitySchema,
  implementationArtifactResultSchema,
  implementationCallbackResultSchema,
  implementationEventsInputSchema,
  implementationEventsSchema,
  implementationQueueInputSchema,
  implementationQueueResultSchema,
  publicEnvironmentSchema,
  startImplementationResultSchema,
  startImplementationSchema,
} from "../../domain/implementationContracts.js";
import { pipelineCallbackSchema } from "../../integrations/ci/callback.js";
import {
  dispatchReconciliationInputSchema,
  dispatchReconciliationResultSchema,
} from "../../domain/implementationDispatch.js";
import { environmentCheckSchema } from "../../domain/implementationContracts.js";
import { implementationProcedure, router } from "../core.js";

export const implementationsRouter = router({
  environment: implementationProcedure
    .input(z.undefined().optional())
    .output(publicEnvironmentSchema)
    .query(({ ctx }) => ctx.implementations.environment()),
  environmentCheck: implementationProcedure
    .input(z.undefined().optional())
    .output(environmentCheckSchema)
    .query(({ ctx }) => ctx.implementations.environmentCheck()),
  queue: implementationProcedure
    .input(implementationQueueInputSchema.optional())
    .output(implementationQueueResultSchema)
    .query(({ ctx, input }) => ctx.implementations.queue(input)),
  start: implementationProcedure
    .input(startImplementationSchema)
    .output(startImplementationResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.start(input)),
  callback: implementationProcedure
    .input(pipelineCallbackSchema)
    .output(implementationCallbackResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.applyCallback(input)),
  reconcile: implementationProcedure
    .input(implementationIdentitySchema)
    .output(implementationCallbackResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.reconcile(input.executionId)),
  collectReport: implementationProcedure
    .input(implementationIdentitySchema)
    .output(implementationCallbackResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.collectReport(input.executionId)),
  reconcileDispatch: implementationProcedure
    .input(dispatchReconciliationInputSchema)
    .output(dispatchReconciliationResultSchema)
    .mutation(({ ctx, input }) => ctx.implementations.reconcileDispatch(input)),
  events: implementationProcedure
    .input(implementationEventsInputSchema)
    .output(implementationEventsSchema)
    .query(({ ctx, input }) => ctx.implementations.events(input)),
  artifact: implementationProcedure
    .input(implementationArtifactIdentitySchema)
    .output(implementationArtifactResultSchema)
    .query(({ ctx, input }) => ctx.implementations.artifact(input.executionId, input.artifactId)),
  list: implementationProcedure
    .input(implementationListInputSchema.optional())
    .output(implementationListSchema)
    .query(({ ctx, input }) => ctx.implementations.list(input)),
  byId: implementationProcedure
    .input(implementationIdentitySchema)
    .output(implementationDetailSchema)
    .query(({ ctx, input }) => ctx.implementations.byId(input.executionId)),
});
