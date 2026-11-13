import { z } from "zod";

export const ticketStatuses = [
  "aberto",
  "em_triagem",
  "recusado",
  "aguardando_informacoes",
  "aguardando_implementacao",
  "em_andamento",
  "aguardando_revisao",
  "resolvido",
] as const;
export const ticketStatusSchema = z.enum(ticketStatuses);
export const classificationSchema = z.enum([
  "falso_positivo",
  "entendimento_incorreto",
  "bug",
  "melhoria",
  "inconclusivo",
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TriageClassification = z.infer<typeof classificationSchema>;
export const executionKindSchema = z.enum(["triage", "implementation"]);
export type ExecutionKind = z.infer<typeof executionKindSchema>;
export const triageStatusSchema = z.enum(["valid", "invalidated", "superseded"]);
export type TriageStatus = z.infer<typeof triageStatusSchema>;

export const defaultCategories = [
  { slug: "validacao_entrada", label: "Validação de entrada" },
  { slug: "regra_negocio", label: "Regra de negócio" },
  { slug: "calculo", label: "Cálculo" },
];

const text = () =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"));
const positiveInteger = z.number().int().positive().max(2147483647);
const category = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u);

export const triageSourcePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !/[\\:]/u.test(value) &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }) &&
      value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  );
export const sourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const sourceHashesSchema = z.record(triageSourcePathSchema, sourceHashSchema);
export const triageEvidenceSchema = z.strictObject({
  ruleStatus: z.enum(["established", "missing", "conflicting"]),
  behavior: z.enum(["divergent", "conforming", "disproved", "unverified"]),
  verificationStatus: z.enum(["succeeded", "failed", "unavailable", "not_run"]),
  evidenceSufficient: z.boolean(),
  changeRequested: z.boolean(),
  expectationMisunderstood: z.boolean(),
  sources: z
    .array(z.strictObject({ path: triageSourcePathSchema, sha256: sourceHashSchema }))
    .max(1000)
    .refine((sources) => new Set(sources.map((source) => source.path)).size === sources.length),
  questions: z.array(text().min(1).max(10000)).max(50),
  humanReviewRequired: z.boolean(),
});
export type TriageEvidence = z.infer<typeof triageEvidenceSchema>;
export type TriageDecision = {
  classification: TriageClassification;
  status: Extract<
    TicketStatus,
    "aberto" | "recusado" | "aguardando_informacoes" | "aguardando_implementacao"
  >;
  questions: string[];
  humanReviewRequired: boolean;
};

export const eligibilityResultSchema = z.discriminatedUnion("eligible", [
  z.strictObject({ eligible: z.literal(true) }),
  z.strictObject({
    eligible: z.literal(false),
    code: z.enum([
      "TRIAGE_REQUIRED",
      "TRIAGE_OUTDATED",
      "IMPLEMENTATION_NOT_ELIGIBLE",
      "CRITERIA_REQUIRED",
      "PRECONDITION_FAILED",
      "ACTIVE_EXECUTION",
    ]),
    message: z.string().min(1),
    activeExecutionId: z.uuid().optional(),
  }),
]);
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;

export interface ImplementationTriage {
  id: string;
  ticketId: number;
  ticketVersion: number;
  classification: TriageClassification;
  status: TriageStatus;
  sourceHashes: Record<string, string>;
  changeScope: string | null;
  acceptanceCriteria: readonly string[];
  regressionTestPlan: string | null;
}

export interface ImplementationEnvironment {
  ready: boolean;
  activeExecutionId: string | null;
  sourceHashes: Readonly<Record<string, string>>;
}

export const targetSystemKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);

export const ticketContentSchema = z.strictObject({
  targetSystemKey: targetSystemKeySchema,
  title: text().min(5).max(140),
  description: text().min(20).max(10000),
  expectedBehavior: text().min(10).max(5000),
  reproductionSteps: text()
    .max(10000)
    .nullable()
    .optional()
    .transform((value) => value || null),
  category,
});
export type TicketContent = z.infer<typeof ticketContentSchema>;

export const paginationSchema = z.strictObject({
  page: positiveInteger.default(1),
  pageSize: z.number().int().min(1).max(50).default(15),
});
export const listTicketsSchema = paginationSchema.extend({
  q: text().max(200).optional(),
  status: ticketStatusSchema.optional(),
  category: category.optional(),
});
export const ticketIdentitySchema = z.strictObject({ ticketId: positiveInteger });
export const ticketVersionSchema = ticketIdentitySchema.extend({
  expectedVersion: positiveInteger,
});
export const updateTicketSchema = ticketContentSchema.extend(ticketVersionSchema.shape);
export const messageTicketSchema = ticketVersionSchema.extend({
  message: text().min(1).max(10000),
});
export const requestChangesSchema = ticketVersionSchema.extend({
  kind: z.enum(["behavior", "refinement"]),
  message: text().min(1).max(10000),
});
export type RequestChangesInput = z.infer<typeof requestChangesSchema>;
export const resolveTicketSchema = ticketVersionSchema.extend({
  mergeConfirmed: z.literal(true),
  testVerified: z.literal(true),
  message: text().min(1).max(10000).optional(),
});
export const ticketEventsInputSchema = paginationSchema.extend(ticketIdentitySchema.shape);

const isoDate = z.iso.datetime();
export const ticketSchema = z.strictObject({
  id: positiveInteger,
  code: z.string().regex(/^RES-\d{3,}$/u),
  targetSystemKey: targetSystemKeySchema,
  targetConfigVersion: positiveInteger,
  title: z.string(),
  description: z.string(),
  expectedBehavior: z.string(),
  reproductionSteps: z.string().nullable(),
  category: z.string(),
  status: ticketStatusSchema,
  version: positiveInteger,
  classification: classificationSchema.nullable(),
  currentTriageId: z.uuid().nullable(),
  triageStatus: triageStatusSchema.nullable(),
  triageVersion: positiveInteger.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  resolvedAt: isoDate.nullable(),
});
export type Ticket = z.infer<typeof ticketSchema>;
export type ImplementationTicket = Pick<
  Ticket,
  "id" | "version" | "status" | "classification" | "currentTriageId"
>;
export const ticketListSchema = z.strictObject({
  items: z.array(ticketSchema),
  total: z.number().int().nonnegative(),
  ...paginationSchema.shape,
});

export const ticketEventSchema = z.strictObject({
  id: z.uuid(),
  ticketId: positiveInteger,
  type: z.string(),
  fromStatus: ticketStatusSchema.nullable(),
  toStatus: ticketStatusSchema.nullable(),
  message: z.string(),
  payload: z.record(z.string(), z.json()),
  createdAt: isoDate,
});
export const ticketEventsSchema = z.strictObject({
  items: z.array(ticketEventSchema),
  total: z.number().int().nonnegative(),
  ...paginationSchema.shape,
});
export const ticketDetailsSchema = z.strictObject({
  ticket: ticketSchema,
  latestExecution: z
    .strictObject({
      id: z.uuid(),
      kind: executionKindSchema,
      status: z.enum(["em_andamento", "bloqueada", "falhou", "concluida", "interrompida"]),
      stage: z.string().nullable(),
      startedAt: isoDate,
      completedAt: isoDate.nullable(),
    })
    .nullable(),
  currentDelivery: z
    .strictObject({
      id: z.uuid(),
      number: positiveInteger,
      prNumber: positiveInteger.nullable(),
      prUrl: z.url().nullable(),
      prState: z.string().nullable(),
    })
    .nullable(),
});
export type TicketDetails = z.infer<typeof ticketDetailsSchema>;
export type TicketList = z.infer<typeof ticketListSchema>;
export type TicketEvents = z.infer<typeof ticketEventsSchema>;
export type ListTicketsInput = z.infer<typeof listTicketsSchema>;
export type TicketEventsInput = z.infer<typeof ticketEventsInputSchema>;
