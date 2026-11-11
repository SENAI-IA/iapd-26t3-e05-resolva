import { z } from "zod";
import { hasControlCharacters } from "../../config/strings.js";
import {
  parsePipelineCallback,
  type PipelineCallback,
  type PipelineCallbackIdentity,
} from "./callback.js";

const repositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);
const branchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\s\\~^:?*[\]]/u.test(value) && !value.includes(".."));
const workflowSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacters(value));
const pipelineInputSchema = z.strictObject({
  executionId: z.uuid(),
  repository: repositorySchema,
  workflow: workflowSchema,
  ref: branchSchema,
  fields: z
    .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u), z.string().max(1000))
    .default({}),
});

export type PipelineInput = z.input<typeof pipelineInputSchema>;
export interface PipelineReference extends PipelineCallbackIdentity {
  workflowId: string;
  workflowUrl: string;
  status: "queued";
}

export interface PipelineTransport {
  dispatch(input: Readonly<z.output<typeof pipelineInputSchema>>): Promise<{
    workflowId: string;
    workflowUrl: string;
  }>;
  reconcile(reference: PipelineReference): Promise<unknown | null>;
}

function referenceSchema(value: {
  executionId: string;
  repository: string;
  workflowId: string;
  workflowUrl: string;
}): PipelineReference {
  return {
    executionId: z.uuid().parse(value.executionId),
    repository: repositorySchema.parse(value.repository),
    workflowId: z.string().trim().min(1).max(200).parse(value.workflowId),
    workflowUrl: z.url().parse(value.workflowUrl),
    status: "queued",
  };
}

export function createPipelineClient(transport: PipelineTransport) {
  const dispatches = new Map<string, Promise<PipelineReference>>();
  return {
    async triggerPipeline(input: PipelineInput): Promise<PipelineReference> {
      const parsed = pipelineInputSchema.parse(input);
      const existing = dispatches.get(parsed.executionId);
      if (existing) return existing;
      const dispatch = (async () => {
        const result = await transport.dispatch(parsed);
        return referenceSchema({ ...parsed, ...result });
      })();
      dispatches.set(parsed.executionId, dispatch);
      try {
        return await dispatch;
      } catch (error) {
        dispatches.delete(parsed.executionId);
        throw error;
      }
    },
    async reconcilePipeline(reference: PipelineReference): Promise<PipelineCallback | null> {
      const parsedReference = referenceSchema(reference);
      const value = await transport.reconcile(parsedReference);
      if (value === null) return null;
      return parsePipelineCallback(value, parsedReference);
    },
  };
}

export type PipelineClient = ReturnType<typeof createPipelineClient>;
