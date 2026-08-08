/**
 * Runs the explainer against the most expensive session in the database.
 * This is the demo's core beat, so it gets a script you can run on its own.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/try-explain.ts
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, usageEvents, toolCalls } from "../db/schema";
import { computeSignals, type SessionLike } from "../lib/signals";
import { streamExplanation, renderDigest } from "../lib/explain";

async function main() {
  const db = getDb();

  const [session] = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.totalCostUsd))
    .limit(1);

  if (!session) {
    console.error("No sessions in the database. Run the client first.");
    process.exit(1);
  }

  const events = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.sessionId, session.id))
    .orderBy(usageEvents.seq);

  const tools = await db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.sessionId, session.id));

  // Tool calls are stored in their own table, so re-attach them to their events.
  const bySeq = new Map<number, { name: string; target: string | null }[]>();
  for (const t of tools) {
    const list = bySeq.get(t.eventSeq) ?? [];
    list.push({ name: t.name, target: t.target });
    bySeq.set(t.eventSeq, list);
  }

  const shaped: SessionLike = {
    sessionId: session.id,
    gitBranch: session.gitBranch,
    cwd: session.cwd,
    startedAt: session.startedAt.toISOString(),
    endedAt: (session.endedAt ?? session.startedAt).toISOString(),
    events: events.map((e) => ({
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

  const signals = computeSignals([shaped]);
  const ctx = {
    identifier: session.repo ? `repo:${session.repo}` : session.id.slice(0, 8),
    title: session.cwd ?? "Untitled session",
    cohort: null,
    cohortP50: null,
    cohortP90: null,
    signals,
  };

  console.log("--- digest sent to the model ---\n");
  console.log(renderDigest(ctx));
  console.log("\n--- explanation ---\n");

  const stream = streamExplanation(ctx);
  stream.on("text", (delta) => process.stdout.write(delta));
  const final = await stream.finalMessage();

  console.log(
    `\n\n[${final.usage.input_tokens} in / ${final.usage.output_tokens} out, ` +
      `stop=${final.stop_reason}]`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
