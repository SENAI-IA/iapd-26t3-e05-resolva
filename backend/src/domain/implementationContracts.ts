import { z } from "zod";
import {
  classificationSchema,
  eligibilityResultSchema,
  paginationSchema,
  targetSystemKeySchema,
  ticketIdentitySchema,
  ticketSchema,
} from "./contracts.js";

export const publicTargetSystemSchema = z.strictObject({
  targetSystemKey: targetSystemKeySchema,
  displayName: z.string().min(1),
  version: z.number().int().positive(),
  repository: z.string().min(1),
  baseBranch: z.string().min(1),
  workflowRef: z.string().min(1),
  categories: z.array(
    z.strictObject({
      slug: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
});
export type PublicTargetSystem = z.infer<typeof publicTargetSystemSchema>;

export const publicEnvironmentSchema = z.strictObject({
  ready: z.boolean(),
  sourceCount: z.number().int().nonnegative(),
  targetSystem: publicTargetSystemSchema.nullable(),
});
export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export const environmentCheckSchema = z.strictObject({
  ready: z.boolean(),
  targetConfigured: z.boolean(),
  sourcesReady: z.boolean(),
  githubInstalled: z.boolean(),
  githubAuthenticated: z.boolean(),
  message: z.string().min(1),
});
export type EnvironmentCheck = z.infer<typeof environmentCheckSchema>;

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
export const retryImplementationSchema = z.strictObject({
  executionId: z.uuid(),
  requestKey: z.uuid(),
});
export type RetryImplementationInput = z.infer<typeof retryImplementationSchema>;

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
  publishedSha: z.string().nullable(),
  status: executionStatusSchema,
  stage: z.string().nullable(),
  mode: executionModeSchema.nullable(),
  round: z.number().int().nonnegative().max(3),
  outcome: z.string().nullable(),
  diagnosis: z.string().nullable(),
  blockerCode: z.string().nullable(),
  blockerMessage: z.string().nullable(),
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

const executionEventSchema = z.strictObject({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  stage: z.string().nullable(),
  message: z.string().min(1),
  payload: z.record(z.string(), z.json()),
  createdAt: isoDate,
});
export const implementationEventsInputSchema = implementationIdentitySchema.extend({
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
});
export type ImplementationEventsInput = z.infer<typeof implementationEventsInputSchema>;
export const implementationEventsSchema = z.strictObject({
  items: z.array(executionEventSchema),
  nextSequence: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type ImplementationEvents = z.infer<typeof implementationEventsSchema>;

export const implementationArtifactIdentitySchema = implementationIdentitySchema.extend({
  artifactId: z.uuid(),
});
export const implementationArtifactSchema = z.strictObject({
  id: z.uuid(),
  kind: z.string().min(1),
  relativePath: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: isoDate,
});
export const implementationArtifactResultSchema = z.strictObject({
  artifact: implementationArtifactSchema,
  content: z.string().max(64 * 1024),
});
export type ImplementationArtifactIdentity = z.infer<typeof implementationArtifactIdentitySchema>;
export type ImplementationArtifactResult = z.infer<typeof implementationArtifactResultSchema>;

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
export const implementationValidationSchema = z.strictObject({
  baseline: z.strictObject({
    status: z.enum(["passed", "assertion_failed"]),
    total: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  regression: z.strictObject({
    status: z.enum(["passed", "assertion_failed"]),
    total: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  final: z.strictObject({
    status: z.enum(["passed", "assertion_failed"]),
    total: z.number().int().positive(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  test: z.strictObject({
    path: z.string().min(1),
    frozenSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    finalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  report: z.strictObject({
    artifactId: z.uuid().nullable(),
    relativePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024),
  }),
});
export type ImplementationValidation = z.infer<typeof implementationValidationSchema>;
export const implementationDetailSchema = z.strictObject({
  execution: implementationExecutionSchema,
  ticket: ticketSchema,
  triage: implementationTriageSchema.nullable(),
  delivery: implementationDeliverySchema.nullable(),
  validation: implementationValidationSchema.nullable(),
});
export type ImplementationDetail = z.infer<typeof implementationDetailSchema>;
