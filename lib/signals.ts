/**
 * Turns a session's raw trace into the structured digest the explainer reads.
 *
 * The server computes the signals; Claude writes the prose. That split keeps
 * the explainer fast enough to run live on stage, cheap enough to run on every
 * issue, and — because the numbers are computed rather than generated — means
 * Claude is never in a position to invent a statistic.
 */

import { costOf, inputShare, type CostBreakdown } from "./pricing";

export type SessionLike = {
  sessionId: string;
  gitBranch: string | null;
  cwd: string | null;
  startedAt: string;
  endedAt: string;
  events: {
    seq: number;
    ts: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWrite5mTokens: number;
    cacheWrite1hTokens: number;
    iterations: number;
    toolCalls: { name: string; target: string | null }[];
  }[];
};

export type RepeatedTarget = {
  target: string;
  count: number;
  /** Distinct tools that touched it — Read x8 reads differently from Edit x8. */
  tools: string[];
  /** Longest run of consecutive touches without any other target between. */
  longestStreak: number;
};

export type Signals = {
  sessionCount: number;
  messageCount: number;
  toolCallCount: number;
  durationMinutes: number;
  models: string[];

  cost: CostBreakdown;
  /** Share of total cost that is input-side (input + cache read + cache write). */
  inputSharePct: number;

  /** Cache reads as a share of all prompt tokens. Low here means thrash. */
  cacheHitRatePct: number;

  /** Targets touched more than the threshold, worst first. */
  repeatedTargets: RepeatedTarget[];
  toolMix: { name: string; count: number }[];

  /** Requests that took more than one internal iteration. Usually zero. */
  retryCount: number;

  /** Most expensive single message, as a share of the session. */
  peakMessageSharePct: number;

  /** Plain-language notes worth putting in front of the model. */
  notes: string[];
};

const REPEAT_THRESHOLD = 3;

export function computeSignals(sessions: SessionLike[]): Signals {
  const cost: CostBreakdown = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    total: 0,
    priced: true,
  };

  const targetCounts = new Map<string, { count: number; tools: Set<string> }>();
  const toolCounts = new Map<string, number>();
  const targetSequence: string[] = [];
  const models = new Set<string>();

  let messageCount = 0;
  let toolCallCount = 0;
  let retryCount = 0;
  let promptTokens = 0;
  let cacheReadTokens = 0;
  let peakMessageCost = 0;
  let earliest = Infinity;
  let latest = -Infinity;

  for (const s of sessions) {
    earliest = Math.min(earliest, Date.parse(s.startedAt));
    latest = Math.max(latest, Date.parse(s.endedAt));

    for (const e of s.events) {
      messageCount++;
      models.add(e.model);
      if (e.iterations > 1) retryCount += e.iterations - 1;

      const c = costOf(e.model, new Date(e.ts), e);
      cost.input += c.input;
      cost.output += c.output;
      cost.cacheRead += c.cacheRead;
      cost.cacheWrite5m += c.cacheWrite5m;
      cost.cacheWrite1h += c.cacheWrite1h;
      cost.total += c.total;
      if (c.total > peakMessageCost) peakMessageCost = c.total;

      promptTokens +=
        e.inputTokens + e.cacheReadTokens + e.cacheWrite5mTokens + e.cacheWrite1hTokens;
      cacheReadTokens += e.cacheReadTokens;

      for (const t of e.toolCalls) {
        toolCallCount++;
        toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
        if (!t.target) continue;
        targetSequence.push(t.target);
        const entry = targetCounts.get(t.target) ?? { count: 0, tools: new Set<string>() };
        entry.count++;
        entry.tools.add(t.name);
        targetCounts.set(t.target, entry);
      }
    }
  }

  const repeatedTargets: RepeatedTarget[] = [...targetCounts.entries()]
    .filter(([, v]) => v.count >= REPEAT_THRESHOLD)
    .map(([target, v]) => ({
      target,
      count: v.count,
      tools: [...v.tools],
      longestStreak: longestStreak(targetSequence, target),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const inputSharePct = cost.total === 0 ? 0 : inputShare(cost) * 100;
  const cacheHitRatePct = promptTokens === 0 ? 0 : (cacheReadTokens / promptTokens) * 100;
  const durationMinutes =
    Number.isFinite(earliest) && Number.isFinite(latest) ? (latest - earliest) / 60000 : 0;

  return {
    sessionCount: sessions.length,
    messageCount,
    toolCallCount,
    durationMinutes,
    models: [...models],
    cost,
    inputSharePct,
    cacheHitRatePct,
    repeatedTargets,
    toolMix: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    retryCount,
    peakMessageSharePct: cost.total === 0 ? 0 : (peakMessageCost / cost.total) * 100,
    notes: buildNotes({ inputSharePct, cacheHitRatePct, repeatedTargets, retryCount }),
  };
}

function longestStreak(seq: string[], target: string): number {
  let best = 0;
  let run = 0;
  for (const t of seq) {
    if (t === target) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

function buildNotes(s: {
  inputSharePct: number;
  cacheHitRatePct: number;
  repeatedTargets: RepeatedTarget[];
  retryCount: number;
}): string[] {
  const notes: string[] = [];

  if (s.inputSharePct >= 90) {
    notes.push(
      `${s.inputSharePct.toFixed(0)}% of spend was input-side. The agent spent far more reading than writing.`,
    );
  }

  if (s.cacheHitRatePct < 70) {
    notes.push(
      `Cache hit rate was ${s.cacheHitRatePct.toFixed(0)}%, below the 89-95% typical of well-structured sessions. Context was being rebuilt rather than reused.`,
    );
  }

  const worst = s.repeatedTargets[0];
  if (worst && worst.count >= 5) {
    notes.push(
      `\`${worst.target}\` was touched ${worst.count} times via ${worst.tools.join(", ")}` +
        (worst.longestStreak >= 3 ? `, including ${worst.longestStreak} times back to back.` : "."),
    );
  }

  if (s.retryCount > 0) {
    notes.push(`${s.retryCount} request(s) needed an internal retry.`);
  }

  if (notes.length === 0) {
    notes.push("No cost anomalies detected; this session looks unremarkable.");
  }

  return notes;
}
