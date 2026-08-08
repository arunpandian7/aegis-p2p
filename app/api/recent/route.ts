import { NextResponse } from "next/server";
import { recentSessions, totals } from "@/lib/queries";
import { drain } from "@/lib/stream";

/**
 * Polled by /live. The database is the source of truth; the in-process notice
 * buffer only decorates rows that landed very recently, and an empty buffer
 * (cold or different serverless instance) degrades to "no flash" rather than
 * to wrong data.
 */
export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const [rows, t] = await Promise.all([recentSessions(20), totals()]);
  const fresh = new Set(drain(since).map((n) => n.sessionId));

  return NextResponse.json(
    {
      now: Date.now(),
      totals: t,
      sessions: rows.map((s) => ({
        id: s.id,
        repo: s.repo,
        branch: s.gitBranch,
        surface: s.surface,
        cost: s.totalCostUsd,
        messages: s.messageCount,
        tools: s.toolCallCount,
        method: s.attributionMethod,
        confidence: s.attributionConfidence,
        startedAt: s.startedAt,
        fresh: fresh.has(s.id),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
