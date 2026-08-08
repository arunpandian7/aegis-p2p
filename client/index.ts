/**
 * The machine client.
 *
 * Walks ~/.claude/projects, parses every transcript, and posts them to the
 * server. It keeps no cursor and no local state: whole sessions are replayed
 * on every run, and the server dedupes on (session_id, seq). That makes the
 * client safe to re-run at any moment — including mid-demo — and means a
 * crashed run leaves nothing to reconcile.
 *
 *   AEGIS_URL=https://... AEGIS_KEY=aegis_mk_... pnpm client
 *   pnpm client --dry     # parse and summarise without sending
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import { parseTranscript, type SessionRecord } from "./parse";
import { costOf } from "../lib/pricing";

const PROJECTS = process.env.AEGIS_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
const SERVER = (process.env.AEGIS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.AEGIS_KEY ?? "";
const MACHINE = process.env.AEGIS_MACHINE ?? hostname();
const BATCH_SIZE = 5;

const dryRun = process.argv.includes("--dry");

function transcriptPaths(): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(PROJECTS);
  } catch {
    console.error(`No transcripts directory at ${PROJECTS}`);
    return out;
  }
  for (const dir of dirs) {
    const full = join(PROJECTS, dir);
    try {
      if (!statSync(full).isDirectory()) continue;
      for (const f of readdirSync(full)) {
        if (f.endsWith(".jsonl")) out.push(join(full, f));
      }
    } catch {
      // A project directory can vanish between readdir and stat; skip it.
    }
  }
  return out;
}

function sessionCost(s: SessionRecord): number {
  return s.events.reduce((sum, e) => sum + costOf(e.model, new Date(e.ts), e).total, 0);
}

async function send(batch: SessionRecord[]): Promise<void> {
  const res = await fetch(`${SERVER}/api/ingest/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ machine: MACHINE, sessions: batch }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ingest failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { accepted: number; events: number };
  console.log(`  sent ${batch.length} session(s) → accepted ${json.accepted}, ${json.events} events`);
}

async function main() {
  const paths = transcriptPaths();
  console.log(`${paths.length} transcript(s) under ${PROJECTS}`);

  const parsed: SessionRecord[] = [];
  for (const p of paths) {
    try {
      const s = await parseTranscript(p);
      if (s) parsed.push(s);
    } catch (err) {
      console.warn(`  skipped ${p}: ${(err as Error).message}`);
    }
  }

  const total = parsed.reduce((sum, s) => sum + sessionCost(s), 0);
  console.log(
    `parsed ${parsed.length} session(s), ` +
      `${parsed.reduce((n, s) => n + s.events.length, 0)} messages, ` +
      `$${total.toFixed(2)}`,
  );

  if (dryRun) {
    for (const s of parsed) {
      console.log(
        `  ${s.sessionId.slice(0, 8)}  $${sessionCost(s).toFixed(3).padStart(8)}  ` +
          `${s.events.length} msgs  ${s.gitBranch ?? "-"}  ${s.cwd ?? ""}`,
      );
    }
    return;
  }

  if (!KEY) {
    console.error("AEGIS_KEY is not set. Generate one at /settings/keys and export it.");
    process.exit(1);
  }

  console.log(`sending to ${SERVER} as machine "${MACHINE}"`);
  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    await send(parsed.slice(i, i + BATCH_SIZE));
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
