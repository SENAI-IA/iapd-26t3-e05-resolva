import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const ticketStatus = pgEnum("ticket_status", [
  "aberto",
  "em_triagem",
  "recusado",
  "aguardando_informacoes",
  "aguardando_implementacao",
  "em_andamento",
  "aguardando_revisao",
  "resolvido",
]);
export const classification = pgEnum("triage_classification", [
  "falso_positivo",
  "entendimento_incorreto",
  "bug",
  "melhoria",
  "inconclusivo",
]);
export const executionKind = pgEnum("execution_kind", ["triage", "implementation"]);
export const executionStatus = pgEnum("execution_status", [
  "em_andamento",
  "bloqueada",
  "falhou",
  "concluida",
  "interrompida",
]);
export const executionMode = pgEnum("execution_mode", [
  "initial",
  "retry",
  "review_behavior",
  "review_refinement",
]);
export const executionStage = pgEnum("execution_stage", [
  "preparando_contexto",
  "analisando_ticket",
  "consolidando_triagem",
  "preparando_ambiente",
  "reproduzindo_problema",
  "implementando_correcao",
  "validando",
  "publicando_pr",
]);
export const triageStatus = pgEnum("triage_status", ["valid", "invalidated", "superseded"]);

const entityId = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const object = (name: string) => jsonb(name).$type<JsonObject>();

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    targetSystemKey: varchar("target_system_key", { length: 64 }).notNull(),
    targetConfigVersion: integer("target_config_version").notNull(),
    targetConfigSnapshot: object("target_config_snapshot").notNull(),
    title: varchar("title", { length: 140 }).notNull(),
    description: text("description").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    reproductionSteps: text("reproduction_steps"),
    category: varchar("category", { length: 64 }).notNull(),
    status: ticketStatus("status").default("aberto").notNull(),
    version: integer("version").default(1).notNull(),
    classification: classification("classification"),
    currentTriageId: uuid("current_triage_id").references((): AnyPgColumn => triages.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    check("tickets_positive_version", sql`${table.version} > 0`),
    check("tickets_positive_config_version", sql`${table.targetConfigVersion} > 0`),
    check("tickets_positive_id", sql`${table.id} > 0`),
    index("tickets_queue_idx").on(table.status, table.updatedAt, table.id),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: entityId(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id),
    type: text("type").notNull(),
    fromStatus: ticketStatus("from_status"),
    toStatus: ticketStatus("to_status"),
    message: text("message").notNull(),
    payload: object("payload").default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("ticket_events_history_idx").on(table.ticketId, table.createdAt, table.id)],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: entityId(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id),
    number: integer("number").notNull(),
    firstExecutionId: uuid("first_execution_id").references((): AnyPgColumn => executions.id),
    repository: text("repository").notNull(),
    baseBranch: text("base_branch").notNull(),
    branchName: text("branch_name").notNull(),
    baseSha: varchar("base_sha", { length: 64 }),
    remoteHeadSha: varchar("remote_head_sha", { length: 64 }),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    prState: text("pr_state"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("deliveries_ticket_number_unique").on(table.ticketId, table.number),
    unique("deliveries_repository_branch_unique").on(table.repository, table.branchName),
    check("deliveries_positive_number", sql`${table.number} > 0`),
  ],
);

export const executions = pgTable(
  "executions",
  {
    id: entityId(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id),
    ticketVersion: integer("ticket_version").notNull(),
    kind: executionKind("kind").notNull(),
    triageId: uuid("triage_id").references((): AnyPgColumn => triages.id),
    deliveryId: uuid("delivery_id").references(() => deliveries.id),
    previousExecutionId: uuid("previous_execution_id"),
    reproductionExecutionId: uuid("reproduction_execution_id"),
    requestKey: uuid("request_key").notNull().unique(),
    mode: executionMode("mode"),
    status: executionStatus("status").default("em_andamento").notNull(),
    stage: executionStage("stage"),
    round: integer("round").default(0).notNull(),
    ticketSnapshot: object("ticket_snapshot").notNull(),
    configSnapshot: object("config_snapshot").default({}).notNull(),
    outcome: text("outcome"),
    diagnosis: text("diagnosis"),
    blockerCode: text("blocker_code"),
    blockerMessage: text("blocker_message"),
    baseSha: varchar("base_sha", { length: 64 }),
    validatedSha: varchar("validated_sha", { length: 64 }),
    publishedSha: varchar("published_sha", { length: 64 }),
    kiroVersion: text("kiro_version"),
    kiroEngine: text("kiro_engine"),
    kiroModel: text("kiro_model"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("executions_one_active")
      .on(sql`(1)`)
      .where(sql`${table.status} = 'em_andamento'`),
    index("executions_ticket_idx").on(table.ticketId, table.startedAt, table.id),
    check("executions_positive_version", sql`${table.ticketVersion} > 0`),
    check("executions_round_limit", sql`${table.round} BETWEEN 0 AND 3`),
    foreignKey({ columns: [table.previousExecutionId], foreignColumns: [table.id] }),
    foreignKey({ columns: [table.reproductionExecutionId], foreignColumns: [table.id] }),
  ],
);

export const triages = pgTable(
  "triages",
  {
    id: entityId(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id),
    executionId: uuid("execution_id")
      .notNull()
      .unique()
      .references(() => executions.id),
    ticketVersion: integer("ticket_version").notNull(),
    ticketSnapshot: object("ticket_snapshot").notNull(),
    classification: classification("classification").notNull(),
    status: triageStatus("status").default("valid").notNull(),
    summary: text("summary").notNull(),
    observedBehavior: text("observed_behavior").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    ruleInterpretation: text("rule_interpretation").notNull(),
    diagnosis: text("diagnosis").notNull(),
    sources: jsonb("sources").$type<JsonObject[]>().default([]).notNull(),
    references: jsonb("references").$type<JsonObject[]>().default([]).notNull(),
    uncertainties: jsonb("uncertainties").$type<string[]>().default([]).notNull(),
    questions: jsonb("questions").$type<string[]>().default([]).notNull(),
    nextAction: text("next_action").notNull(),
    changeScope: text("change_scope"),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().default([]).notNull(),
    regressionTestPlan: text("regression_test_plan"),
    sourceHashes: object("source_hashes").default({}).notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
  },
  (table) => [
    check("triages_positive_version", sql`${table.ticketVersion} > 0`),
    index("triages_ticket_version_idx").on(table.ticketId, table.ticketVersion, table.createdAt),
    foreignKey({ columns: [table.supersededBy], foreignColumns: [table.id] }),
  ],
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: entityId(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => executions.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    stage: executionStage("stage"),
    message: text("message").notNull(),
    payload: object("payload").default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("execution_events_sequence_unique").on(table.executionId, table.sequence),
    check("execution_events_positive_sequence", sql`${table.sequence} > 0`),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: entityId(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => executions.id),
    kind: text("kind").notNull(),
    relativePath: text("relative_path").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("artifacts_execution_idx").on(table.executionId),
    check("artifacts_nonnegative_size", sql`${table.sizeBytes} >= 0`),
  ],
);
