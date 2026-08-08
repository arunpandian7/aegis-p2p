import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
 */

export const maxDuration = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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
  let eventsWritten = 0;

  for (const incoming of payload.sessions) {
    if (!incoming?.sessionId || !Array.isArray(incoming.events)) continue;

    const startedAt = new Date(incoming.startedAt);
    const endedAt = new Date(incoming.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) continue;

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
      messageCount: Math.max(0, Math.trunc(incoming.messageCount ?? incoming.events.length)),
      toolCallCount: totals.tools,
      isSeeded: false,
    };

    await db
      .insert(sessions)
      .values(sessionRow)
      .onConflictDoUpdate({ target: sessions.id, set: sessionRow });

    if (eventRows.length) {
      // (sessionId, seq) is unique, so a replay of an already-ingested slice
      // updates in place instead of duplicating.
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

    // Replaying a growing web chat is a sync, not a new attribution decision.
    // Preserve the audit trail without appending the same decision every time.
    const previousAttribution = await db
      .select({
        workUnitId: attributions.workUnitId,
        method: attributions.method,
        confidence: attributions.confidence,
      })
      .from(attributions)
      .where(eq(attributions.sessionId, incoming.sessionId))
      .orderBy(sql`${attributions.createdAt} desc`)
      .limit(1);

    const previous = previousAttribution[0];
    if (
      !previous ||
      previous.workUnitId !== workUnitId ||
      previous.method !== attr.method ||
      previous.confidence !== attr.confidence
    ) {
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
      attribution: `${attr.method}/${attr.confidence}`,
    });
  }

  await db.update(machines).set({ lastSeenAt: new Date() }).where(eq(machines.id, machine.id));

  return json({
    accepted: accepted.length,
    events: eventsWritten,
    sessionIds: accepted,
  });
}
