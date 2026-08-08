ALTER TABLE "aegis"."sessions" ADD COLUMN "provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "external_project_id" text;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "external_project_name" text;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "external_conversation_id" text;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "external_conversation_url" text;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "conversation_title" text;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "capture_method" text DEFAULT 'transcript' NOT NULL;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "usage_basis" text DEFAULT 'reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "sessions_provider_project_idx" ON "aegis"."sessions" USING btree ("provider","external_project_id");