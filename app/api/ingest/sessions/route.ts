import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
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
  cwd?: string | null;
  gitBranch?: string | null;
  ccVersion?: string | null;
  startedAt: string;
  endedAt: string;
  surface?: string;
  costBasis?: "dollars" | "pool";
  isPrivate?: boolean;
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
    return NextResponse.json({ error: "invalid or missing ingest key" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (!Array.isArray(payload?.sessions)) {
    return NextResponse.json({ error: "body must contain a sessions array" }, { status: 400 });
  }

  const db = getDb();
  const accepted: string[] = [];
  let eventsWritten = 0;

  for (const incoming of payload.sessions) {
    if (!incoming?.sessionId || !Array.isArray(incoming.events)) continue;

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
      startedAt: new Date(incoming.startedAt),
      endedAt: new Date(incoming.endedAt),
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
      messageCount: incoming.events.length,
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
            costUsd: usageEvents.costUsd,
            model: usageEvents.model,
          },
        });
      eventsWritten += eventRows.length;
    }

    // Tool calls have no natural unique key, so replace the session's set
    // wholesale rather than trying to dedupe row by row.
    if (toolRows.length) {
      await db.delete(toolCalls).where(eq(toolCalls.sessionId, incoming.sessionId));
      await db.insert(toolCalls).values(toolRows);
    }

    await db.insert(attributions).values({
      sessionId: incoming.sessionId,
      workUnitId,
      method: attr.method,
      confidence: attr.confidence,
      actor: "system",
      rationale: attr.rationale,
    });

    accepted.push(incoming.sessionId);
    publish({
      type: "session",
      sessionId: incoming.sessionId,
      repo: sessionRow.repo,
      branch: sessionRow.gitBranch,
      costUsd: totals.cost,
      messages: incoming.events.length,
      attribution: `${attr.method}/${attr.confidence}`,
    });
  }

  await db.update(machines).set({ lastSeenAt: new Date() }).where(eq(machines.id, machine.id));

  return NextResponse.json({
    accepted: accepted.length,
    events: eventsWritten,
    sessionIds: accepted,
  });
}
