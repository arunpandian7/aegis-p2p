import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { basename } from "node:path";

/**
 * Parses a Claude Code transcript (~/.claude/projects/<slug>/<uuid>.jsonl)
 * into the ingest payload.
 *
 * Shape verified against real transcripts on 2026-08-08, Claude Code 2.1.224.
 * Every row carries sessionId, cwd, gitBranch, timestamp and version; assistant
 * rows carry message.model and message.usage.
 *
 * Deliberately tolerant: transcripts contain many row types we don't care about
 * (mode, permission-mode, attachment, file-history-snapshot, ai-title, ...) and
 * new ones appear between Claude Code releases. Unknown rows are skipped, not
 * treated as errors.
 */

export type ToolCallRecord = {
  name: string;
  target: string | null;
};

export type UsageEventRecord = {
  seq: number;
  requestId: string | null;
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  iterations: number;
  toolCalls: ToolCallRecord[];
};

export type SessionRecord = {
  sessionId: string;
  cwd: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  startedAt: string;
  endedAt: string;
  events: UsageEventRecord[];
};

/**
 * Which input field carries the thing the agent actually touched. This is the
 * field the explainer groups by to find re-read loops, so getting it right per
 * tool matters more than it looks.
 */
function toolTarget(name: string, input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const i = input as Record<string, unknown>;

  const path = i.file_path ?? i.notebook_path ?? i.path;
  if (typeof path === "string") return path;

  if (typeof i.pattern === "string") {
    // Grep/Glob: the pattern plus its search root is the unit of repetition.
    const scope = typeof i.path === "string" ? i.path : "";
    return scope ? `${i.pattern} @ ${scope}` : i.pattern;
  }

  if (typeof i.command === "string") return bashHead(i.command);

  if (typeof i.url === "string") return i.url;
  if (typeof i.skill === "string") return i.skill;

  return null;
}

/**
 * Reduces a shell command to the thing worth counting repeats of.
 *
 * Full command lines are too high-cardinality to group on, and a naive
 * whitespace split mangles quoted paths (`cd "/a/b c/d"` becomes `cd "/a/b`).
 * So: tokenise respecting quotes, skip past `cd <dir> &&` navigation prefixes
 * to the command that actually does work, then keep the command plus its
 * subcommand (`git status`, `npm test`, `pdflatex`).
 */
export function bashHead(command: string): string {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  let i = 0;
  // Walk past any number of `cd <dir> &&` / `cd <dir>;` prefixes.
  while (i < tokens.length && tokens[i] === "cd") {
    const sep = tokens.findIndex((t, j) => j > i && (t === "&&" || t === ";" || t === "||"));
    if (sep === -1) return "cd"; // the whole command is navigation
    i = sep + 1;
  }

  // Skip leading environment assignments (`TEXINPUTS=".:../:" pdflatex`).
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;

  const head = tokens[i];
  if (!head) return "cd";

  // A subcommand is a bare word; a flag or path is not worth pairing.
  const next = tokens[i + 1];
  if (next && /^[a-z][\w-]*$/i.test(next)) return `${head} ${next}`;
  return head;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function parseTranscript(filePath: string): Promise<SessionRecord | null> {
  const events: UsageEventRecord[] = [];
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let ccVersion: string | null = null;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let seq = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      // Transcripts are appended live; a torn final line is normal.
      continue;
    }

    const ts = typeof row.timestamp === "string" ? row.timestamp : null;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    if (typeof row.sessionId === "string") sessionId = row.sessionId;
    if (typeof row.cwd === "string") cwd = row.cwd;
    if (typeof row.gitBranch === "string") gitBranch = row.gitBranch;
    if (typeof row.version === "string") ccVersion = row.version;

    if (row.type !== "assistant") continue;

    const message = row.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    // cache_creation splits by TTL and the two bill at different rates
    // (1h = 2x input, 5m = 1.25x). Fall back to the flat total only when the
    // breakdown is absent, attributing it to 5m as the cheaper assumption.
    const creation = usage.cache_creation as Record<string, unknown> | undefined;
    let write1h = num(creation?.ephemeral_1h_input_tokens);
    let write5m = num(creation?.ephemeral_5m_input_tokens);
    if (!creation) {
      write5m = num(usage.cache_creation_input_tokens);
      write1h = 0;
    }

    const iterations = Array.isArray(usage.iterations) ? usage.iterations.length : 1;

    const toolCalls: ToolCallRecord[] = [];
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as Record<string, unknown>).type === "tool_use"
        ) {
          const b = block as Record<string, unknown>;
          const name = typeof b.name === "string" ? b.name : "unknown";
          toolCalls.push({ name, target: toolTarget(name, b.input) });
        }
      }
    }

    events.push({
      seq: seq++,
      requestId: typeof row.requestId === "string" ? row.requestId : null,
      ts: ts ?? new Date().toISOString(),
      model: typeof message.model === "string" ? message.model : "unknown",
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheWrite5mTokens: write5m,
      cacheWrite1hTokens: write1h,
      iterations,
      toolCalls,
    });
  }

  if (!sessionId || events.length === 0) return null;

  return {
    sessionId,
    cwd,
    gitBranch,
    ccVersion,
    startedAt: firstTs ?? events[0].ts,
    endedAt: lastTs ?? events[events.length - 1].ts,
    events,
  };
}

export function sessionIdFromPath(filePath: string): string {
  return basename(filePath, ".jsonl");
}
