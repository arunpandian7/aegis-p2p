import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, workUnits, usageEvents, toolCalls } from "@/db/schema";

/**
 * Read paths for the UI.
 *
 * One rule runs through all of them: private sessions never roll up. Every
 * aggregate here filters `is_private = false`, so the privacy stance is a
 * property of the queries rather than a promise in the pitch. The only place
 * private sessions surface is the owner's own view.
 */

export type IssueRow = {
  id: string;
  identifier: string;
  title: string;
  state: string;
  cohort: string | null;
  url: string | null;
  estimate: number | null;
  costUsd: number;
  sessionCount: number;
  claudeCodeCostUsd: number;
  chatCostUsd: number;
  methods: string[];
  confidences: string[];
};

export async function listIssues(): Promise<IssueRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: workUnits.id,
      identifier: workUnits.identifier,
      title: workUnits.title,
      state: workUnits.state,
      cohort: workUnits.cohort,
      url: workUnits.url,
      estimate: workUnits.estimate,
      costUsd: sql<number>`coalesce(sum(${sessions.totalCostUsd}), 0)`,
      sessionCount: sql<number>`count(${sessions.id})`,
      claudeCodeCostUsd: sql<number>`coalesce(sum(${sessions.totalCostUsd}) filter (where ${sessions.surface} = 'claude_code'), 0)`,
      chatCostUsd: sql<number>`coalesce(sum(${sessions.totalCostUsd}) filter (where ${sessions.surface} = 'chat'), 0)`,
      methods: sql<string[]>`coalesce(array_agg(distinct ${sessions.attributionMethod}) filter (where ${sessions.id} is not null), '{}')`,
      confidences: sql<string[]>`coalesce(array_agg(distinct ${sessions.attributionConfidence}) filter (where ${sessions.id} is not null), '{}')`,
    })
    .from(workUnits)
    .leftJoin(
      sessions,
      and(eq(sessions.workUnitId, workUnits.id), eq(sessions.isPrivate, false)),
    )
    .groupBy(workUnits.id)
    .orderBy(desc(sql`coalesce(sum(${sessions.totalCostUsd}), 0)`));

  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd), sessionCount: Number(r.sessionCount) }));
}

/**
 * Cohort quantiles. Deliberately a band, never a point: the same agent on the
 * same task varies up to 30x, so a single expected number would be dishonest.
 */
export async function cohortBands(): Promise<
  Record<string, { p50: number; p90: number; n: number }>
> {
  const db = getDb();
  const rows = await db
    .select({
      cohort: workUnits.cohort,
      p50: sql<number>`percentile_cont(0.5) within group (order by t.cost)`,
      p90: sql<number>`percentile_cont(0.9) within group (order by t.cost)`,
      n: sql<number>`count(*)`,
    })
    .from(
      sql`(
        select ${workUnits.id} as id,
               coalesce(sum(${sessions.totalCostUsd}), 0) as cost
        from ${workUnits}
        left join ${sessions}
          on ${sessions.workUnitId} = ${workUnits.id} and ${sessions.isPrivate} = false
        group by ${workUnits.id}
      ) as t`,
    )
    .innerJoin(workUnits, sql`${workUnits.id} = t.id`)
    .groupBy(workUnits.cohort);

  const out: Record<string, { p50: number; p90: number; n: number }> = {};
  for (const r of rows) {
    if (!r.cohort) continue;
    out[r.cohort] = { p50: Number(r.p50), p90: Number(r.p90), n: Number(r.n) };
  }
  return out;
}

export async function getIssue(identifier: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(workUnits)
    .where(eq(workUnits.identifier, identifier.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function sessionsForIssue(workUnitId: string) {
  const db = getDb();
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.workUnitId, workUnitId), eq(sessions.isPrivate, false)))
    .orderBy(desc(sessions.totalCostUsd));
}

export async function getSession(id: string) {
  const db = getDb();
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function eventsForSession(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.sessionId, sessionId))
    .orderBy(usageEvents.seq);
}

export async function toolCallsForSession(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.sessionId, sessionId))
    .orderBy(toolCalls.eventSeq);
}

/** Sessions with no work unit yet — the queue on the engineer's own page. */
export async function unattributedSessions(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(sessions)
    .where(isNull(sessions.workUnitId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
}

export async function recentSessions(limit = 25) {
  const db = getDb();
  return db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit);
}

export async function totals() {
  const db = getDb();
  const rows = await db
    .select({
      cost: sql<number>`coalesce(sum(${sessions.totalCostUsd}), 0)`,
      sessions: sql<number>`count(*)`,
      attributed: sql<number>`count(*) filter (where ${sessions.workUnitId} is not null)`,
    })
    .from(sessions)
    .where(eq(sessions.isPrivate, false));

  const r = rows[0];
  return {
    cost: Number(r?.cost ?? 0),
    sessions: Number(r?.sessions ?? 0),
    attributed: Number(r?.attributed ?? 0),
  };
}
