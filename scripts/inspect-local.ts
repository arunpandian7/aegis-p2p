/**
 * Parses every Claude Code transcript on this machine and prints what Aegis
 * would ingest. No database, no network — a fast check that the parser and
 * pricing engine agree with reality.
 *
 *   pnpm exec tsx scripts/inspect-local.ts
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTranscript } from "../client/parse";
import { costOf, inputShare } from "../lib/pricing";
import { attribute } from "../lib/attribution";

const ROOT = join(homedir(), ".claude", "projects");

async function main() {
  let grandTotal = 0;
  let unpriced = 0;
  const rows: string[] = [];

  for (const dir of readdirSync(ROOT)) {
    let files: string[];
    try {
      files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const s = await parseTranscript(join(ROOT, dir, file));
      if (!s) continue;

      let cost = 0;
      let tools = 0;
      let retries = 0;
      let inputSide = 0;
      const models = new Set<string>();
      const targets = new Map<string, number>();

      for (const e of s.events) {
        const c = costOf(e.model, new Date(e.ts), e);
        if (!c.priced) unpriced++;
        cost += c.total;
        inputSide += c.input + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h;
        tools += e.toolCalls.length;
        retries += e.iterations - 1;
        models.add(e.model);
        for (const t of e.toolCalls) {
          if (t.target) targets.set(t.target, (targets.get(t.target) ?? 0) + 1);
        }
      }

      grandTotal += cost;
      const a = attribute({ gitBranch: s.gitBranch, cwd: s.cwd });
      const worst = [...targets.entries()].sort((x, y) => y[1] - x[1])[0];
      const share = cost === 0 ? 0 : (inputSide / cost) * 100;

      rows.push(
        [
          s.sessionId.slice(0, 8),
          dir.replace("-home-arun-", "").padEnd(20).slice(0, 20),
          `$${cost.toFixed(3)}`.padStart(8),
          `msgs=${String(s.events.length).padStart(3)}`,
          `tools=${String(tools).padStart(3)}`,
          `retry=${retries}`,
          `in=${share.toFixed(0)}%`,
          `${a.method}/${a.confidence}`,
          worst ? `top: ${worst[0].split("/").pop()} x${worst[1]}` : "",
        ].join("  "),
      );
    }
  }

  console.log(rows.join("\n"));
  console.log(`\n${rows.length} sessions · $${grandTotal.toFixed(2)} total`);
  if (unpriced) console.log(`WARNING: ${unpriced} events had no rate on file`);
}

main();
