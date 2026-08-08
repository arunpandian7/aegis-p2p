import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { machines, sessions, usageEvents, toolCalls, attributions, workUnits } from "@/db/schema";
import { costOf } from "@/lib/pricing";
import { attribute } from "@/lib/attribution";
import { publish } from "@/lib/stream";

/**
 * POST /api/ingest/sessions
 *
 * The machine client replays whole transcript files on every tick rather than
 * tracking a cursor. That is only safe because ingestion is idempotent on
 * (session_id, seq): re-sending a session you already sent is a no-op, so
 * there is no partial-write state to get wrong and re-running the client
 * mid-demo cannot double-count.
 *
 * The browser collector (`extension/`) posts here too, with the same
 * idempotency contract but different content: one aggregate event at seq=0 per
 * conversation, `usage_basis = 'estimated'` and `cost_basis = 'pool'`, so its
 * token figures can never reach a dollar total. See ADR-0002.
 */

export const maxDuration = 300;

/**
 * The browser collector posts from an extension service worker, whose origin is
 * `chrome-extension://<id>`. Only that scheme is answered with CORS headers:
 * a wildcard would let any page a victim visits replay a leaked ingest key from
 * their browser, and the Node clients (`client/index.ts`, the scripts) are not
 * subject to CORS at all, so they lose nothing.
 */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin?.startsWith("chrome-extension://")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

type IncomingToolCall = { name: string; target: string | null };

type IncomingEvent = {
  seq: number;
  requestId?: string | null;
  ts: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  iterations?: number;
  toolCalls?: IncomingToolCall[];
};

type IncomingSession = {
  sessionId: string;
  provider?: "anthropic" | "openai";
  externalProjectId?: string | null;
  externalProjectName?: string | null;
  externalConversationId?: string | null;
  externalConversationUrl?: string | null;
  conversationTitle?: string | null;
  captureMethod?: "transcript" | "extension" | "export" | "compliance_api";
  usageBasis?: "reported" | "estimated" | "unavailable";
  contentHash?: string | null;
  cwd?: string | null;
  gitBranch?: string | null;
  ccVersion?: string | null;
  startedAt: string;
  endedAt: string;
  surface?: string;
  costBasis?: "dollars" | "pool";
  isPrivate?: boolean;
  messageCount?: number;
  events: IncomingEvent[];
};

type Payload = { machine: string; sessions: IncomingSession[] };

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function authenticate(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const db = getDb();
  const rows = await db.select().from(machines).where(eq(machines.keyHash, hashKey(token))).limit(1);
  return rows[0] ?? null;
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

  const machine = await authenticate(req);
  if (!machine) {
    return json({ error: "invalid or missing ingest key" }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "malformed JSON body" }, 400);
  }

  if (!Array.isArray(payload?.sessions)) {
    return json({ error: "body must contain a sessions array" }, 400);
  }

  const db = getDb();
  const accepted: string[] = [];
  const rejected: { sessionId: string | null; reason: string }[] = [];
  let eventsWritten = 0;

  for (const incoming of payload.sessions) {
    if (!incoming?.sessionId || !Array.isArray(incoming.events)) {
      rejected.push({ sessionId: incoming?.sessionId ?? null, reason: "missing sessionId or events" });
      continue;
    }

    // A bad timestamp would otherwise reach Postgres as `Invalid Date` and fail
    // the whole request, taking every other session in the batch with it. The
    // browser collector reads its timestamps out of the DOM, so this is a real
    // input, not a theoretical one.
    const startedAt = new Date(incoming.startedAt);
    const endedAt = new Date(incoming.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
      rejected.push({ sessionId: incoming.sessionId, reason: "startedAt or endedAt is not a valid date" });
      continue;
    }

    // Resolve attribution up front so it lands with the session row.
    const attr = attribute({ gitBranch: incoming.gitBranch, cwd: incoming.cwd });
    let workUnitId: string | null = null;
    if (attr.identifier) {
      const wu = await db
        .select({ id: workUnits.id })
        .from(workUnits)
        .where(eq(workUnits.identifier, attr.identifier))
        .limit(1);
      workUnitId = wu[0]?.id ?? null;
    }

    let totals = {
      cost: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tools: 0,
    };

    const eventRows = [];
    const toolRows = [];

    for (const e of incoming.events) {
      const counts = {
        inputTokens: e.inputTokens ?? 0,
        outputTokens: e.outputTokens ?? 0,
        cacheReadTokens: e.cacheReadTokens ?? 0,
        cacheWrite5mTokens: e.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: e.cacheWrite1hTokens ?? 0,
      };
      // Price against the event's own timestamp, not now — rates change, and a
      // session replayed next month must still cost what it cost.
      const cost = costOf(e.model, new Date(e.ts), counts);

      totals.cost += cost.total;
      totals.input += counts.inputTokens;
      totals.output += counts.outputTokens;
      totals.cacheRead += counts.cacheReadTokens;
      totals.cacheWrite += counts.cacheWrite5mTokens + counts.cacheWrite1hTokens;

      eventRows.push({
        sessionId: incoming.sessionId,
        seq: e.seq,
        requestId: e.requestId ?? null,
        ts: new Date(e.ts),
        model: e.model,
        ...counts,
        iterations: e.iterations ?? 1,
        costUsd: cost.total,
      });

      for (const t of e.toolCalls ?? []) {
        totals.tools++;
        toolRows.push({
          sessionId: incoming.sessionId,
          eventSeq: e.seq,
          name: t.name,
          target: t.target,
          ts: new Date(e.ts),
        });
      }
    }

    const sessionRow = {
      id: incoming.sessionId,
      machineId: machine.id,
      userId: machine.userId,
      surface: incoming.surface ?? "claude_code",
      cwd: incoming.cwd ?? null,
      repo: incoming.cwd?.split("/").pop() ?? null,
      gitBranch: incoming.gitBranch ?? null,
      ccVersion: incoming.ccVersion ?? null,
      provider: incoming.provider ?? "anthropic",
      externalProjectId: incoming.externalProjectId ?? null,
      externalProjectName: incoming.externalProjectName ?? null,
      externalConversationId: incoming.externalConversationId ?? null,
      externalConversationUrl: incoming.externalConversationUrl ?? null,
      conversationTitle: incoming.conversationTitle ?? null,
      captureMethod: incoming.captureMethod ?? "transcript",
      usageBasis: incoming.usageBasis ?? "reported",
      contentHash: incoming.contentHash ?? null,
      startedAt,
      endedAt,
      workUnitId,
      attributionMethod: attr.method,
      attributionConfidence: attr.confidence,
      isPrivate: incoming.isPrivate ?? false,
      costBasis: incoming.costBasis ?? "dollars",
      totalCostUsd: totals.cost,
      totalInputTokens: totals.input,
      totalOutputTokens: totals.output,
      totalCacheReadTokens: totals.cacheRead,
      totalCacheWriteTokens: totals.cacheWrite,
      // Transcript sessions have one event per message; a web conversation is a
      // single aggregate event, so the collector reports the count separately.
      messageCount: Number.isFinite(incoming.messageCount)
        ? Math.max(0, Math.trunc(incoming.messageCount as number))
        : incoming.events.length,
      toolCallCount: totals.tools,
      isSeeded: false,
    };

    /**
     * A replay refreshes measurements, never decisions.
     *
     * `set: sessionRow` would write the freshly *inferred* attribution over
     * whatever is already there — so tagging a session on /me and then
     * re-running the collector silently un-tagged it and un-marked it private.
     * Rare with transcripts, which are usually replayed once; constant with the
     * browser collector, which re-syncs every time a conversation grows.
     *
     * So: if the stored row carries a human decision — `tagged` or `explicit`,
     * the two methods at the top of the ladder in `lib/attribution.ts` — its
     * work unit, method, confidence and privacy flag survive the write. Nothing
     * the engineer chose is overwritten by something we guessed.
     */
    const keepIfHuman = <T>(column: T, incomingValue: unknown) =>
      sql`case when ${sessions.attributionMethod} in ('tagged', 'explicit')
               then ${column}
               else ${incomingValue} end`;

    await db
      .insert(sessions)
      .values(sessionRow)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          ...sessionRow,
          workUnitId: keepIfHuman(sessions.workUnitId, workUnitId),
          attributionMethod: keepIfHuman(sessions.attributionMethod, attr.method),
          attributionConfidence: keepIfHuman(sessions.attributionConfidence, attr.confidence),
          isPrivate: keepIfHuman(sessions.isPrivate, sessionRow.isPrivate),
        },
      });

    if (eventRows.length) {
      // (sessionId, seq) is unique, so a replay of an already-ingested slice
      // updates in place instead of duplicating.
      //
      // Every mutable column takes its value from `excluded` — the row we tried
      // to insert. Setting them from the table's own columns is a no-op that
      // reads like an update: harmless while a transcript slice is immutable,
      // silently wrong for the browser collector, whose single seq=0 event
      // grows with the conversation and must overwrite its predecessor.
      await db
        .insert(usageEvents)
        .values(eventRows)
        .onConflictDoUpdate({
          target: [usageEvents.sessionId, usageEvents.seq],
          set: {
            requestId: sql`excluded.request_id`,
            ts: sql`excluded.ts`,
            model: sql`excluded.model`,
            inputTokens: sql`excluded.input_tokens`,
            outputTokens: sql`excluded.output_tokens`,
            cacheReadTokens: sql`excluded.cache_read_tokens`,
            cacheWrite5mTokens: sql`excluded.cache_write_5m_tokens`,
            cacheWrite1hTokens: sql`excluded.cache_write_1h_tokens`,
            iterations: sql`excluded.iterations`,
            costUsd: sql`excluded.cost_usd`,
          },
        });
      eventsWritten += eventRows.length;
    }

    // Tool calls have no natural unique key, so replace the session's set
    // wholesale rather than trying to dedupe row by row.
    await db.delete(toolCalls).where(eq(toolCalls.sessionId, incoming.sessionId));
    if (toolRows.length) {
      await db.insert(toolCalls).values(toolRows);
    }

    // The audit trail records *changes*, not observations. Both collectors
    // replay whole conversations on every run — a transcript file for Claude
    // Code, a growing chat for the extension — so appending unconditionally
    // would grow this table without ever saying anything new.
    const [latest] = await db
      .select({
        workUnitId: attributions.workUnitId,
        method: attributions.method,
        confidence: attributions.confidence,
      })
      .from(attributions)
      .where(eq(attributions.sessionId, incoming.sessionId))
      .orderBy(desc(attributions.createdAt), desc(attributions.id))
      .limit(1);

    // Matches what the upsert above preserved: where an engineer has decided,
    // a replay that infers `none` is not a change of mind, it is the collector
    // running again. Recording it would write a retraction into the audit trail
    // that nobody performed.
    const humanDecision = latest?.method === "tagged" || latest?.method === "explicit";

    const changed =
      !humanDecision &&
      (!latest ||
        latest.workUnitId !== workUnitId ||
        latest.method !== attr.method ||
        latest.confidence !== attr.confidence);

    if (changed) {
      await db.insert(attributions).values({
        sessionId: incoming.sessionId,
        workUnitId,
        method: attr.method,
        confidence: attr.confidence,
        actor: "system",
        rationale: attr.rationale,
      });
    }

    accepted.push(incoming.sessionId);
    publish({
      type: "session",
      sessionId: incoming.sessionId,
      repo: sessionRow.repo,
      branch: sessionRow.gitBranch,
      costUsd: totals.cost,
      messages: sessionRow.messageCount,
      // Report what the row now carries, not what this replay inferred — a
      // tagged session that just re-synced is still tagged.
      attribution: humanDecision
        ? `${latest.method}/${latest.confidence}`
        : `${attr.method}/${attr.confidence}`,
    });
  }

  await db.update(machines).set({ lastSeenAt: new Date() }).where(eq(machines.id, machine.id));

  return json({
    accepted: accepted.length,
    events: eventsWritten,
    sessionIds: accepted,
    rejected,
  });
}
