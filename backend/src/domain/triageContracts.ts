import { z } from "zod";
import {
  classificationSchema,
  paginationSchema,
  sourceHashesSchema,
  ticketDetailsSchema,
  ticketIdentitySchema,
  ticketVersionSchema,
  triageEvidenceSchema,
  triageSourcePathSchema,
  triageStatusSchema,
} from "./contracts.js";

export const startTriageSchema = ticketVersionSchema.extend({ requestKey: z.uuid() });
export type StartTriageInput = z.infer<typeof startTriageSchema>;
export const startTriageResultSchema = z.strictObject({ triageExecutionId: z.uuid() });
export const triageIdentitySchema = z.strictObject({ triageId: z.uuid() });
export const listTriagesSchema = paginationSchema.extend({
  ticketId: ticketIdentitySchema.shape.ticketId.optional(),
  classification: classificationSchema.optional(),
  status: triageStatusSchema.optional(),
});
export type ListTriagesInput = z.infer<typeof listTriagesSchema>;

const reportText = z
  .string()
  .trim()
  .min(1)
  .max(10000)
  .refine((value) => !value.includes("\0"));
const referenceSchema = z
  .strictObject({
    path: triageSourcePathSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine(({ startLine, endLine }) => startLine <= endLine);
const reportFields = {
  summary: reportText,
  observedBehavior: reportText,
  expectedBehavior: reportText,
  ruleInterpretation: reportText,
  diagnosis: reportText,
  references: z.array(referenceSchema).max(1000),
  uncertainties: z.array(reportText).max(50),
  nextAction: reportText,
  changeScope: reportText.nullable(),
  acceptanceCriteria: z.array(reportText).max(50),
  regressionTestPlan: reportText.nullable(),
  promptVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/u),
};

export const triageReportSchema = z
  .strictObject({ ...reportFields, evidence: triageEvidenceSchema })
  .refine(({ references, evidence }) => {
    const paths = new Set(evidence.sources.map(({ path }) => path));
    return references.every(({ path }) => paths.has(path));
  });

export const triageDetailSchema = z.strictObject({
  ...reportFields,
  uncertainties: z.array(reportText).max(51),
  id: z.uuid(),
  ticketId: ticketIdentitySchema.shape.ticketId,
  ticketVersion: ticketVersionSchema.shape.expectedVersion,
  classification: classificationSchema,
  status: triageStatusSchema,
  sources: triageEvidenceSchema.shape.sources,
  questions: triageEvidenceSchema.shape.questions,
  sourceHashes: sourceHashesSchema,
  createdAt: z.iso.datetime(),
  invalidatedAt: z.iso.datetime().nullable(),
  supersededBy: z.uuid().nullable(),
  execution: ticketDetailsSchema.shape.latestExecution.unwrap().extend({
    kind: z.literal("triage"),
    outcome: z.string().nullable(),
  }),
});
export type TriageDetail = z.infer<typeof triageDetailSchema>;
export const triageListSchema = z.strictObject({
  ...paginationSchema.shape,
  items: z.array(triageDetailSchema),
  total: z.number().int().nonnegative(),
});
