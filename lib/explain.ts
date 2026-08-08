import Anthropic from "@anthropic-ai/sdk";
import type { Signals } from "./signals";

/**
 * "Why did ENG-142 cost $47 when its cohort averages $3?"
 *
 * The server computes every number (lib/signals.ts); Claude only turns the
 * digest into prose. That ordering is deliberate — it keeps the call fast
 * enough to run live, and it means the model is never in a position to invent
 * a statistic. If a figure appears in the answer, it was computed.
 */

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export type ExplainContext = {
  identifier: string;
  title: string;
  cohort: string | null;
  cohortP50: number | null;
  cohortP90: number | null;
  signals: Signals;
};

const SYSTEM = `You explain why a unit of engineering work cost what it did in AI tokens.

You are given a precomputed digest of an issue's agent sessions. Every number in it is already calculated — use those figures verbatim and never estimate, round differently, or infer a statistic that isn't present.

Write 3-5 sentences of plain prose for an engineering manager. Lead with the single biggest driver of cost, name the specific evidence (file paths, tool counts, percentages), then say what would have made it cheaper. Refer to files by their base name, not the full path.

Do not use headers, bullet points, or bold. Do not restate the whole digest. Do not open with "This issue" or "The session" — start with what actually happened. If the digest shows nothing anomalous, say so in one sentence rather than manufacturing a concern.`;

function renderDigest(ctx: ExplainContext): string {
  const s = ctx.signals;
  const lines: string[] = [];

  lines.push(`Issue: ${ctx.identifier} — ${ctx.title}`);
  if (ctx.cohort) lines.push(`Cohort: ${ctx.cohort}`);
  if (ctx.cohortP50 !== null) {
    lines.push(
      `Cohort cost: P50 $${ctx.cohortP50.toFixed(2)}` +
        (ctx.cohortP90 !== null ? `, P90 $${ctx.cohortP90.toFixed(2)}` : ""),
    );
  }
  lines.push("");
  lines.push(`Total cost: $${s.cost.total.toFixed(2)} across ${s.sessionCount} session(s)`);
  lines.push(
    `  input $${s.cost.input.toFixed(2)} · cache read $${s.cost.cacheRead.toFixed(2)} · ` +
      `cache write $${(s.cost.cacheWrite5m + s.cost.cacheWrite1h).toFixed(2)} · ` +
      `output $${s.cost.output.toFixed(2)}`,
  );
  lines.push(`Input-side share: ${s.inputSharePct.toFixed(0)}%`);
  lines.push(`Cache hit rate: ${s.cacheHitRatePct.toFixed(0)}% (89-95% is typical of a healthy session)`);
  lines.push(`Messages: ${s.messageCount} · tool calls: ${s.toolCallCount} · retries: ${s.retryCount}`);
  lines.push(`Wall-clock duration: ${s.durationMinutes.toFixed(0)} minutes`);
  lines.push(`Most expensive single message: ${s.peakMessageSharePct.toFixed(0)}% of the total`);
  lines.push(`Models: ${s.models.join(", ")}`);
  lines.push("");
  lines.push(`Tool mix: ${s.toolMix.map((t) => `${t.name} ${t.count}`).join(", ")}`);

  if (s.repeatedTargets.length) {
    lines.push("");
    lines.push("Repeatedly touched targets:");
    for (const r of s.repeatedTargets) {
      lines.push(
        `  ${r.count}x via ${r.tools.join("/")}` +
          (r.longestStreak >= 3 ? ` (${r.longestStreak} consecutive)` : "") +
          ` — ${r.target}`,
      );
    }
  }

  if (s.notes.length) {
    lines.push("");
    lines.push("Precomputed observations:");
    for (const n of s.notes) lines.push(`  - ${n}`);
  }

  return lines.join("\n");
}

/** Streams the explanation so the demo shows tokens landing, not a spinner. */
export function streamExplanation(ctx: ExplainContext) {
  return client().messages.stream({
    model: "claude-opus-5",
    max_tokens: 1024,
    system: SYSTEM,
    // Turning a computed digest into prose is a summarisation task, not a
    // reasoning-heavy one. Medium keeps it responsive enough to run on stage.
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: renderDigest(ctx) }],
  });
}

export async function explain(ctx: ExplainContext): Promise<string> {
  const message = await streamExplanation(ctx).finalMessage();
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export { renderDigest };
