/**
 * Resolution ladder. Highest-confidence match wins; the method and confidence
 * that produced the match travel with the row forever.
 *
 * The key finding from reading real Claude Code transcripts: every message
 * carries `cwd` AND `gitBranch`. No session-start hook, no OTel resource
 * attribute injection, no `OTEL_RESOURCE_ATTRIBUTES` plumbing is needed to get
 * a Direct/High attribution — the branch name is already there.
 */

export type AttributionMethod =
  | "explicit"
  | "branch"
  | "pr"
  | "tagged"
  | "allocated"
  | "none";

export type Confidence = "high" | "medium" | "low" | "none";

export type Attribution = {
  identifier: string | null;
  method: AttributionMethod;
  confidence: Confidence;
  rationale: string;
};

const NONE: Attribution = {
  identifier: null,
  method: "none",
  confidence: "none",
  rationale: "No issue key found in branch, cwd, or explicit configuration.",
};

/**
 * Matches ENG-142 anywhere in a branch name, with or without a prefix:
 *   arun/ENG-142-fix-auth   feature/eng-142   ENG-142
 * Deliberately requires a hyphen and digits so `release-2024` doesn't match.
 */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/i;

/** Branches that are never issue-specific, so we don't guess from them. */
const TRUNK_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "staging"]);

export function extractIssueKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = ISSUE_KEY.exec(input);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

export type AttributionInput = {
  /** Explicitly injected at session start, if the team wired it up. */
  explicitIssueKey?: string | null;
  gitBranch?: string | null;
  cwd?: string | null;
  /** Issue key derived from a PR that touched this branch. */
  prIssueKey?: string | null;
  /** Set once an engineer confirms a suggestion on their private view. */
  taggedIssueKey?: string | null;
};

export function attribute(input: AttributionInput): Attribution {
  if (input.explicitIssueKey) {
    return {
      identifier: input.explicitIssueKey.toUpperCase(),
      method: "explicit",
      confidence: "high",
      rationale: "Issue key was set explicitly at session start.",
    };
  }

  // An engineer's own confirmation outranks anything we inferred.
  if (input.taggedIssueKey) {
    return {
      identifier: input.taggedIssueKey.toUpperCase(),
      method: "tagged",
      confidence: "high",
      rationale: "Confirmed by the engineer who ran the session.",
    };
  }

  const branch = input.gitBranch?.trim() ?? "";
  if (branch && !TRUNK_BRANCHES.has(branch.toLowerCase())) {
    const key = extractIssueKey(branch);
    if (key) {
      return {
        identifier: key,
        method: "branch",
        confidence: "high",
        rationale: `Branch \`${branch}\` contains issue key ${key}.`,
      };
    }
  }

  if (input.prIssueKey) {
    return {
      identifier: input.prIssueKey.toUpperCase(),
      method: "pr",
      confidence: "medium",
      rationale: "Derived from a pull request linked to this branch.",
    };
  }

  // cwd is a weak signal — a repo is not a unit of work — so it never
  // produces an attribution on its own, only a low-confidence hint.
  const fromCwd = extractIssueKey(input.cwd);
  if (fromCwd) {
    return {
      identifier: fromCwd,
      method: "allocated",
      confidence: "low",
      rationale: `Inferred from working directory path; not a direct link.`,
    };
  }

  return NONE;
}

/**
 * A mix of methods must never be presented as one number. This returns the
 * breakdown so the UI can show it alongside any total.
 */
export function confidenceMix(
  rows: { attributionMethod: string; attributionConfidence: string; totalCostUsd: number }[],
): { method: string; confidence: string; costUsd: number; share: number }[] {
  const total = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const buckets = new Map<string, { method: string; confidence: string; costUsd: number }>();

  for (const r of rows) {
    const key = `${r.attributionMethod}:${r.attributionConfidence}`;
    const b = buckets.get(key) ?? {
      method: r.attributionMethod,
      confidence: r.attributionConfidence,
      costUsd: 0,
    };
    b.costUsd += r.totalCostUsd;
    buckets.set(key, b);
  }

  return [...buckets.values()]
    .map((b) => ({ ...b, share: total === 0 ? 0 : b.costUsd / total }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
