import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { workUnits, sessions, usageEvents, toolCalls, explanations } from "@/db/schema";
import { computeSignals, type SessionLike } from "@/lib/signals";
import { streamExplanation } from "@/lib/explain";
import { cohortBands } from "@/lib/queries";

export const maxDuration = 300;

/**
 * Streams the explanation for an issue as plain text.
 *
 * Streaming is a demo requirement, not a nicety: tokens landing on screen is
 * the difference between "the dashboard is thinking" and a visible answer.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const db = getDb();

  const [issue] = await db
    .select()
    .from(workUnits)
    .where(eq(workUnits.identifier, identifier.toUpperCase()))
    .limit(1);

  if (!issue) return new Response("Unknown issue", { status: 404 });

  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.workUnitId, issue.id), eq(sessions.isPrivate, false)));

  if (rows.length === 0) {
    return new Response("No agent sessions are attributed to this issue yet.", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const ids = rows.map((r) => r.id);
  const [events, tools] = await Promise.all([
    db.select().from(usageEvents).where(inArray(usageEvents.sessionId, ids)),
    db.select().from(toolCalls).where(inArray(toolCalls.sessionId, ids)),
  ]);

  const toolsBySession = new Map<string, Map<number, { name: string; target: string | null }[]>>();
  for (const t of tools) {
    const bySeq = toolsBySession.get(t.sessionId) ?? new Map();
    const list = bySeq.get(t.eventSeq) ?? [];
    list.push({ name: t.name, target: t.target });
    bySeq.set(t.eventSeq, list);
    toolsBySession.set(t.sessionId, bySeq);
  }

  const shaped: SessionLike[] = rows.map((s) => {
    const bySeq = toolsBySession.get(s.id) ?? new Map();
    return {
      sessionId: s.id,
      gitBranch: s.gitBranch,
      cwd: s.cwd,
      startedAt: s.startedAt.toISOString(),
      endedAt: (s.endedAt ?? s.startedAt).toISOString(),
      events: events
        .filter((e) => e.sessionId === s.id)
        .sort((a, b) => a.seq - b.seq)
        .map((e) => ({
          seq: e.seq,
          ts: e.ts.toISOString(),
          model: e.model,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          cacheReadTokens: e.cacheReadTokens,
          cacheWrite5mTokens: e.cacheWrite5mTokens,
          cacheWrite1hTokens: e.cacheWrite1hTokens,
          iterations: e.iterations,
          toolCalls: bySeq.get(e.seq) ?? [],
        })),
    };
  });

  const bands = await cohortBands();
  const band = issue.cohort ? bands[issue.cohort] : undefined;
  const signals = computeSignals(shaped);

  const ctx = {
    identifier: issue.identifier,
    title: issue.title,
    cohort: issue.cohort,
    cohortP50: band?.p50 ?? null,
    cohortP90: band?.p90 ?? null,
    signals,
  };

  const anthropicStream = streamExplanation(ctx);
  const encoder = new TextEncoder();
  let full = "";

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        anthropicStream.on("text", (delta) => {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        });
        await anthropicStream.finalMessage();

        // Cache it so a re-open during rehearsal is instant and free.
        await db.insert(explanations).values({
          workUnitId: issue.id,
          body: full,
          signals: JSON.stringify(signals),
        });
      } catch (err) {
        controller.enqueue(
          encoder.encode(`\n\n[explainer failed: ${(err as Error).message}]`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
