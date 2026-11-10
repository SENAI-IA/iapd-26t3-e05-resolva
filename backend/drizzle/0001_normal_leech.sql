ALTER TABLE "tickets" ADD COLUMN "target_system_key" varchar(64) DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "target_config_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "target_config_snapshot" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_system_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_config_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_config_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_system_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_config_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "target_config_snapshot" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_positive_config_version" CHECK ("tickets"."target_config_version" > 0);