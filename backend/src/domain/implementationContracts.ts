import { z } from "zod";
import {
  classificationSchema,
  eligibilityResultSchema,
  paginationSchema,
  ticketIdentitySchema,
  ticketSchema,
} from "./contracts.js";

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
