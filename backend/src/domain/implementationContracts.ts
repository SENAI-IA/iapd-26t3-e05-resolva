import { z } from "zod";
import {
  classificationSchema,
  eligibilityResultSchema,
  paginationSchema,
  ticketIdentitySchema,
  ticketSchema,
} from "./contracts.js";

export const publicEnvironmentSchema = z.strictObject({
  ready: z.boolean(),
  sourceCount: z.number().int().nonnegative(),
});
export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export const implementationQueueSchema = z.strictObject({
  ticket: ticketSchema,
  eligibility: eligibilityResultSchema,
});
export type ImplementationQueueItem = z.infer<typeof implementationQueueSchema>;

export const implementationQueueInputSchema = paginationSchema.extend({
  classification: classificationSchema.extract(["bug", "melhoria"]).optional(),
  q: z.string().trim().max(200).optional(),
});
export type ImplementationQueueInput = z.infer<typeof implementationQueueInputSchema>;

export const implementationQueueResultSchema = z.strictObject({
  items: z.array(implementationQueueSchema),
  total: z.number().int().nonnegative(),
  ...paginationSchema.shape,
});
export type ImplementationQueueResult = z.infer<typeof implementationQueueResultSchema>;

export const startImplementationSchema = ticketIdentitySchema.extend({
  expectedVersion: z.number().int().positive(),
  requestKey: z.uuid(),
});
export type StartImplementationInput = z.infer<typeof startImplementationSchema>;
export const startImplementationResultSchema = z.strictObject({
  implementationExecutionId: z.uuid(),
});
export type StartImplementationResult = z.infer<typeof startImplementationResultSchema>;

export const implementationCallbackResultSchema = z.strictObject({
  applied: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type ImplementationCallbackResult = z.infer<typeof implementationCallbackResultSchema>;

const executionStatusSchema = z.enum([
  "em_andamento",
  "bloqueada",
  "falhou",
  "concluida",
  "interrompida",
]);
const executionModeSchema = z.enum(["initial", "retry", "review_behavior", "review_refinement"]);
const isoDate = z.iso.datetime();

export const implementationExecutionSchema = z.strictObject({
  id: z.uuid(),
  ticketId: z.number().int().positive(),
  ticketVersion: z.number().int().positive(),
  triageId: z.uuid().nullable(),
  deliveryId: z.uuid().nullable(),
  validatedSha: z.string().nullable(),
  status: executionStatusSchema,
  stage: z.string().nullable(),
  mode: executionModeSchema.nullable(),
  round: z.number().int().nonnegative().max(3),
  outcome: z.string().nullable(),
  workflowId: z.string().nullable(),
  workflowUrl: z.url().nullable(),
  startedAt: isoDate,
  completedAt: isoDate.nullable(),
});
export type ImplementationExecution = z.infer<typeof implementationExecutionSchema>;

export const implementationListItemSchema = z.strictObject({
  execution: implementationExecutionSchema,
  ticket: ticketSchema,
});
export const implementationListInputSchema = paginationSchema.extend({
  ticketId: z.number().int().positive().optional(),
  status: executionStatusSchema.optional(),
});
export const implementationListSchema = z.strictObject({
  items: z.array(implementationListItemSchema),
  total: z.number().int().nonnegative(),
  ...paginationSchema.shape,
});
export type ImplementationListInput = z.infer<typeof implementationListInputSchema>;
export type ImplementationListResult = z.infer<typeof implementationListSchema>;

export const implementationIdentitySchema = z.strictObject({ executionId: z.uuid() });

export const implementationTriageSchema = z.strictObject({
  id: z.uuid(),
  ticketVersion: z.number().int().positive(),
  classification: classificationSchema,
  status: z.enum(["valid", "invalidated", "superseded"]),
  changeScope: z.string().nullable(),
  acceptanceCriteria: z.array(z.string()),
  regressionTestPlan: z.string().nullable(),
});
export const implementationDeliverySchema = z.strictObject({
  id: z.uuid(),
  number: z.number().int().positive(),
  branchName: z.string(),
  baseSha: z.string().nullable(),
  remoteHeadSha: z.string().nullable(),
  prNumber: z.number().int().positive().nullable(),
  prUrl: z.url().nullable(),
  prState: z.string().nullable(),
});
export const implementationDetailSchema = z.strictObject({
  execution: implementationExecutionSchema,
  ticket: ticketSchema,
  triage: implementationTriageSchema.nullable(),
  delivery: implementationDeliverySchema.nullable(),
});
export type ImplementationDetail = z.infer<typeof implementationDetailSchema>;
