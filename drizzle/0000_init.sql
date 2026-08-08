CREATE SCHEMA "aegis";
--> statement-breakpoint
CREATE TABLE "aegis"."attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"work_unit_id" text,
	"method" text NOT NULL,
	"confidence" text NOT NULL,
	"actor" text NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_unit_id" text NOT NULL,
	"body" text NOT NULL,
	"signals" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."machines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "aegis"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" text,
	"user_id" text,
	"surface" text DEFAULT 'claude_code' NOT NULL,
	"cwd" text,
	"repo" text,
	"git_branch" text,
	"cc_version" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"work_unit_id" text,
	"attribution_method" text DEFAULT 'none' NOT NULL,
	"attribution_confidence" text DEFAULT 'none' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"cost_basis" text DEFAULT 'dollars' NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"total_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event_seq" integer NOT NULL,
	"name" text NOT NULL,
	"target" text,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"request_id" text,
	"ts" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_5m_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_1h_tokens" integer DEFAULT 0 NOT NULL,
	"iterations" integer DEFAULT 1 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aegis"."work_units" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" text NOT NULL,
	"estimate" integer,
	"team_key" text,
	"cycle_name" text,
	"assignee_id" text,
	"url" text,
	"labels" text[],
	"cohort" text,
	"cohort_rationale" text,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "aegis"."attributions" ADD CONSTRAINT "attributions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "aegis"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."attributions" ADD CONSTRAINT "attributions_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "aegis"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."explanations" ADD CONSTRAINT "explanations_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "aegis"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."machines" ADD CONSTRAINT "machines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "aegis"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD CONSTRAINT "sessions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "aegis"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "aegis"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."sessions" ADD CONSTRAINT "sessions_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "aegis"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."tool_calls" ADD CONSTRAINT "tool_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "aegis"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."usage_events" ADD CONSTRAINT "usage_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "aegis"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aegis"."work_units" ADD CONSTRAINT "work_units_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "aegis"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_work_unit_idx" ON "aegis"."sessions" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "sessions_started_idx" ON "aegis"."sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "tool_calls_session_idx" ON "aegis"."tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tool_calls_target_idx" ON "aegis"."tool_calls" USING btree ("session_id","target");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_session_seq_idx" ON "aegis"."usage_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "usage_events_session_idx" ON "aegis"."usage_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_units_identifier_idx" ON "aegis"."work_units" USING btree ("identifier");