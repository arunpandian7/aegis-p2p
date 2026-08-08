import {
  pgSchema,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
  serial,
} from "drizzle-orm/pg-core";

/**
 * The pitch is the schema, so it ships first.
 *
 * Two rules are enforced by columns rather than convention:
 *
 *  1. `attributionMethod` + `attributionConfidence` travel with every session.
 *     Direct, derived, tagged and allocated rows must never be summed into one
 *     number without showing the mix.
 *  2. `costBasis` separates real dollars (API/Enterprise) from pool
 *     consumption (seat plans). Seat-plan "cost" is notional. Mixing the two
 *     in a single total is the mistake that gets the tool thrown out by
 *     finance, so the distinction is not optional.
 */

/**
 * Everything lives in its own `aegis` schema rather than `public`. The host
 * project has its own tables (including a `users` table that would otherwise
 * collide), and an isolated schema means `DROP SCHEMA aegis CASCADE` removes
 * every trace of this app without touching anything else.
 */
export const aegis = pgSchema("aegis");

export const attributionMethods = [
  "explicit", // issue key injected at session start
  "branch", // git branch matched ENG-\d+
  "pr", // PR -> Linear issue
  "tagged", // engineer confirmed a suggestion
  "allocated", // spread across activity, no direct link
  "none",
] as const;

export const confidenceLevels = ["high", "medium", "low", "none"] as const;

export const machines = aegis.table("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  userId: text("user_id").references(() => users.id),
  /** sha256 of the ingest key; the key itself is shown once at creation. */
  keyHash: text("key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const users = aegis.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
});

export const workUnits = aegis.table(
  "work_units",
  {
    id: text("id").primaryKey(),
    /** ENG-142 */
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    state: text("state").notNull(),
    estimate: integer("estimate"),
    teamKey: text("team_key"),
    cycleName: text("cycle_name"),
    assigneeId: text("assignee_id").references(() => users.id),
    url: text("url"),
    labels: text("labels").array(),
    /** Cohort assigned by the classifier: schema-migration, ui-tweak, flaky-test... */
    cohort: text("cohort"),
    cohortRationale: text("cohort_rationale"),
    /** True for issues authored to populate the board, false for genuine work. */
    isSeeded: boolean("is_seeded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("work_units_identifier_idx").on(t.identifier)],
);

export const sessions = aegis.table(
  "sessions",
  {
    /** Claude Code's own sessionId — the natural key, so replays are idempotent. */
    id: text("id").primaryKey(),
    machineId: text("machine_id").references(() => machines.id),
    userId: text("user_id").references(() => users.id),
    /** claude_code | chat | api | cursor */
    surface: text("surface").notNull().default("claude_code"),
    cwd: text("cwd"),
    repo: text("repo"),
    gitBranch: text("git_branch"),
    ccVersion: text("cc_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    workUnitId: text("work_unit_id").references(() => workUnits.id),
    attributionMethod: text("attribution_method").notNull().default("none"),
    attributionConfidence: text("attribution_confidence").notNull().default("none"),

    /** Personal sessions never roll up. Enforced in query paths, not just prose. */
    isPrivate: boolean("is_private").notNull().default(false),
    /** dollars | pool — never summed together. */
    costBasis: text("cost_basis").notNull().default("dollars"),

    /** Denormalised rollups, recomputed on ingest. */
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    totalInputTokens: bigint("total_input_tokens", { mode: "number" }).notNull().default(0),
    totalOutputTokens: bigint("total_output_tokens", { mode: "number" }).notNull().default(0),
    totalCacheReadTokens: bigint("total_cache_read_tokens", { mode: "number" }).notNull().default(0),
    totalCacheWriteTokens: bigint("total_cache_write_tokens", { mode: "number" }).notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),

    isSeeded: boolean("is_seeded").notNull().default(false),
  },
  (t) => [
    index("sessions_work_unit_idx").on(t.workUnitId),
    index("sessions_started_idx").on(t.startedAt),
  ],
);

export const usageEvents = aegis.table(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Ordinal within the session. (sessionId, seq) is the idempotency key. */
    seq: integer("seq").notNull(),
    requestId: text("request_id"),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    model: text("model").notNull(),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** Split by TTL: 1h creation bills at 2x input, 5m at 1.25x. */
    cacheWrite5mTokens: integer("cache_write_5m_tokens").notNull().default(0),
    cacheWrite1hTokens: integer("cache_write_1h_tokens").notNull().default(0),

    /** usage.iterations length — retries inside a single request. */
    iterations: integer("iterations").notNull().default(1),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_events_session_seq_idx").on(t.sessionId, t.seq),
    index("usage_events_session_idx").on(t.sessionId),
  ],
);

export const toolCalls = aegis.table(
  "tool_calls",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    eventSeq: integer("event_seq").notNull(),
    /** Read, Edit, Bash, Grep... */
    name: text("name").notNull(),
    /** File path for Read/Edit/Write; command head for Bash. The re-read signal. */
    target: text("target"),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("tool_calls_session_idx").on(t.sessionId),
    index("tool_calls_target_idx").on(t.sessionId, t.target),
  ],
);

/** Audit trail: who attributed what, when, and how. Never overwritten. */
export const attributions = aegis.table("attributions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  workUnitId: text("work_unit_id").references(() => workUnits.id),
  method: text("method").notNull(),
  confidence: text("confidence").notNull(),
  /** system | <userId> */
  actor: text("actor").notNull(),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cached explainer output, so the demo never waits on a cold model call. */
export const explanations = aegis.table("explanations", {
  id: serial("id").primaryKey(),
  workUnitId: text("work_unit_id")
    .notNull()
    .references(() => workUnits.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  signals: text("signals").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
