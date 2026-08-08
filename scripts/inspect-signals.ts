/**
 * Prints the explainer's input digest for the most expensive local session.
 * This is exactly what Claude receives — if it doesn't read as enough to write
 * a good explanation from, the explainer won't be good either.
 *
 *   pnpm exec tsx scripts/inspect-signals.ts
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTranscript } from "../client/parse";
import { computeSignals } from "../lib/signals";
import { costOf } from "../lib/pricing";

const ROOT = join(homedir(), ".claude", "projects");

async function main() {
  const all: { dir: string; session: NonNullable<Awaited<ReturnType<typeof parseTranscript>>> }[] =
    [];
  for (const dir of readdirSync(ROOT)) {
    let files: string[];
    try {
      files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const s = await parseTranscript(join(ROOT, dir, file));
      if (s) all.push({ dir, session: s });
    }
  }

  all.sort((a, b) => {
    const c = (x: (typeof all)[number]) =>
      x.session.events.reduce((sum, e) => sum + costOf(e.model, new Date(e.ts), e).total, 0);
    return c(b) - c(a);
  });

  const top = all[0];
  const sig = computeSignals([top.session]);

  console.log(`=== ${top.dir} / ${top.session.sessionId} ===\n`);
  console.log(`cost         $${sig.cost.total.toFixed(2)}`);
  console.log(
    `  input      $${sig.cost.input.toFixed(2)}   ` +
      `cache read $${sig.cost.cacheRead.toFixed(2)}   ` +
      `cache write $${(sig.cost.cacheWrite5m + sig.cost.cacheWrite1h).toFixed(2)}   ` +
      `output $${sig.cost.output.toFixed(2)}`,
  );
  console.log(`input share  ${sig.inputSharePct.toFixed(1)}%`);
  console.log(`cache hits   ${sig.cacheHitRatePct.toFixed(1)}%`);
  console.log(`messages     ${sig.messageCount}   tools ${sig.toolCallCount}   retries ${sig.retryCount}`);
  console.log(`duration     ${sig.durationMinutes.toFixed(0)} min`);
  console.log(`peak msg     ${sig.peakMessageSharePct.toFixed(1)}% of session`);
  console.log(`models       ${sig.models.join(", ")}`);
  console.log(`\ntool mix     ${sig.toolMix.map((t) => `${t.name}:${t.count}`).join("  ")}`);
  console.log(`\nrepeated targets:`);
  for (const r of sig.repeatedTargets) {
    console.log(`  ${String(r.count).padStart(3)}x  streak=${r.longestStreak}  [${r.tools.join(",")}]  ${r.target}`);
  }
  console.log(`\nnotes:`);
  for (const n of sig.notes) console.log(`  - ${n}`);
}

main();
