CREATE TYPE "public"."triage_classification" AS ENUM('falso_positivo', 'entendimento_incorreto', 'bug', 'melhoria', 'inconclusivo');--> statement-breakpoint
CREATE TYPE "public"."execution_kind" AS ENUM('triage', 'implementation');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('initial', 'retry', 'review_behavior', 'review_refinement');--> statement-breakpoint
CREATE TYPE "public"."execution_stage" AS ENUM('preparando_contexto', 'analisando_ticket', 'consolidando_triagem', 'preparando_ambiente', 'reproduzindo_problema', 'implementando_correcao', 'validando', 'publicando_pr');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('em_andamento', 'bloqueada', 'falhou', 'concluida', 'interrompida');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('aberto', 'em_triagem', 'recusado', 'aguardando_informacoes', 'aguardando_implementacao', 'em_andamento', 'aguardando_revisao', 'resolvido');--> statement-breakpoint
CREATE TYPE "public"."triage_status" AS ENUM('valid', 'invalidated', 'superseded');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"relative_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_nonnegative_size" CHECK ("artifacts"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer NOT NULL,
	"number" integer NOT NULL,
	"first_execution_id" uuid,
	"repository" text NOT NULL,
	"base_branch" text NOT NULL,
	"branch_name" text NOT NULL,
	"base_sha" varchar(64),
	"remote_head_sha" varchar(64),
	"pr_number" integer,
	"pr_url" text,
	"pr_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_ticket_number_unique" UNIQUE("ticket_id","number"),
	CONSTRAINT "deliveries_repository_branch_unique" UNIQUE("repository","branch_name"),
	CONSTRAINT "deliveries_positive_number" CHECK ("deliveries"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"stage" "execution_stage",
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_events_sequence_unique" UNIQUE("execution_id","sequence"),
	CONSTRAINT "execution_events_positive_sequence" CHECK ("execution_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer NOT NULL,
	"ticket_version" integer NOT NULL,
	"kind" "execution_kind" NOT NULL,
	"triage_id" uuid,
	"delivery_id" uuid,
	"previous_execution_id" uuid,
	"reproduction_execution_id" uuid,
	"request_key" uuid NOT NULL,
	"mode" "execution_mode",
	"status" "execution_status" DEFAULT 'em_andamento' NOT NULL,
	"stage" "execution_stage",
	"round" integer DEFAULT 0 NOT NULL,
	"ticket_snapshot" jsonb NOT NULL,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"diagnosis" text,
	"blocker_code" text,
	"blocker_message" text,
	"base_sha" varchar(64),
	"validated_sha" varchar(64),
	"published_sha" varchar(64),
	"kiro_version" text,
	"kiro_engine" text,
	"kiro_model" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "executions_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "executions_positive_version" CHECK ("executions"."ticket_version" > 0),
	CONSTRAINT "executions_round_limit" CHECK ("executions"."round" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer NOT NULL,
	"type" text NOT NULL,
	"from_status" "ticket_status",
	"to_status" "ticket_status",
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(140) NOT NULL,
	"description" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"reproduction_steps" text,
	"category" varchar(64) NOT NULL,
	"status" "ticket_status" DEFAULT 'aberto' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"classification" "triage_classification",
	"current_triage_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tickets_positive_version" CHECK ("tickets"."version" > 0),
	CONSTRAINT "tickets_positive_id" CHECK ("tickets"."id" > 0)
);
--> statement-breakpoint
CREATE TABLE "triages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer NOT NULL,
	"execution_id" uuid NOT NULL,
	"ticket_version" integer NOT NULL,
	"ticket_snapshot" jsonb NOT NULL,
	"classification" "triage_classification" NOT NULL,
	"status" "triage_status" DEFAULT 'valid' NOT NULL,
	"summary" text NOT NULL,
	"observed_behavior" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"rule_interpretation" text NOT NULL,
	"diagnosis" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_action" text NOT NULL,
	"change_scope" text,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regression_test_plan" text,
	"source_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"superseded_by" uuid,
	CONSTRAINT "triages_execution_id_unique" UNIQUE("execution_id"),
	CONSTRAINT "triages_positive_version" CHECK ("triages"."ticket_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_first_execution_id_executions_id_fk" FOREIGN KEY ("first_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_triage_id_triages_id_fk" FOREIGN KEY ("triage_id") REFERENCES "public"."triages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_previous_execution_id_executions_id_fk" FOREIGN KEY ("previous_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_reproduction_execution_id_executions_id_fk" FOREIGN KEY ("reproduction_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_current_triage_id_triages_id_fk" FOREIGN KEY ("current_triage_id") REFERENCES "public"."triages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triages" ADD CONSTRAINT "triages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triages" ADD CONSTRAINT "triages_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triages" ADD CONSTRAINT "triages_superseded_by_triages_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."triages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_execution_idx" ON "artifacts" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_one_active" ON "executions" USING btree ((1)) WHERE "executions"."status" = 'em_andamento';--> statement-breakpoint
CREATE INDEX "executions_ticket_idx" ON "executions" USING btree ("ticket_id","started_at","id");--> statement-breakpoint
CREATE INDEX "ticket_events_history_idx" ON "ticket_events" USING btree ("ticket_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE INDEX "triages_ticket_version_idx" ON "triages" USING btree ("ticket_id","ticket_version","created_at");