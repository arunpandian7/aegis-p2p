/**
 * Token pricing, in USD per million tokens.
 *
 * Cache multipliers are relative to each model's input rate:
 *   read      x0.10
 *   write 5m  x1.25
 *   write 1h  x2.00
 *
 * The 1h/5m split is not cosmetic. A message with 18k tokens of 1h cache
 * creation costs 60% more than the same message at the 5m rate, and cache
 * creation routinely dwarfs raw input on Claude Code sessions.
 *
 * Rates carry an effective range because they change under us: Sonnet 5 is
 * on introductory pricing until 2026-08-31. A session replayed after that
 * date must still price at the rate in force when it ran, so cost is
 * computed against `startedAt`, never against "now".
 */

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2.0;

export type Rate = {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** Inclusive. Null means "since the beginning of time". */
  effectiveFrom: string | null;
  /** Exclusive. Null means "still in force". */
  effectiveTo: string | null;
  note?: string;
};

/** Ordered most-specific first; resolution takes the first date match. */
export const RATES: Rate[] = [
  {
    model: "claude-sonnet-5",
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    effectiveFrom: null,
    effectiveTo: "2026-09-01",
    note: "introductory pricing, expires 2026-08-31",
  },
  {
    model: "claude-sonnet-5",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  },
  { model: "claude-opus-5", inputPerMTok: 5.0, outputPerMTok: 25.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-opus-4-8", inputPerMTok: 5.0, outputPerMTok: 25.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-opus-4-7", inputPerMTok: 5.0, outputPerMTok: 25.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-opus-4-6", inputPerMTok: 5.0, outputPerMTok: 25.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-sonnet-4-6", inputPerMTok: 3.0, outputPerMTok: 15.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-haiku-4-5", inputPerMTok: 1.0, outputPerMTok: 5.0, effectiveFrom: null, effectiveTo: null },
  { model: "claude-fable-5", inputPerMTok: 10.0, outputPerMTok: 50.0, effectiveFrom: null, effectiveTo: null },
  {
    // Claude Code's placeholder for a transcript message that was never an API
    // call (interrupts, local errors). Genuinely free — priced, not unknown.
    model: "<synthetic>",
    inputPerMTok: 0,
    outputPerMTok: 0,
    effectiveFrom: null,
    effectiveTo: null,
  },
];

export function resolveRate(model: string, at: Date): Rate | null {
  const iso = at.toISOString();
  return (
    RATES.find(
      (r) =>
        r.model === model &&
        (r.effectiveFrom === null || iso >= r.effectiveFrom) &&
        (r.effectiveTo === null || iso < r.effectiveTo),
    ) ?? null
  );
}

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
};

export type CostBreakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  total: number;
  /** False when the model has no rate on file — the number is a floor, not a cost. */
  priced: boolean;
};

const ZERO: CostBreakdown = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  total: 0,
  priced: false,
};

export function costOf(model: string, at: Date, t: TokenCounts): CostBreakdown {
  const rate = resolveRate(model, at);
  if (!rate) return ZERO;

  const perTok = rate.inputPerMTok / 1_000_000;
  const input = t.inputTokens * perTok;
  const output = t.outputTokens * (rate.outputPerMTok / 1_000_000);
  const cacheRead = t.cacheReadTokens * perTok * CACHE_READ_MULTIPLIER;
  const cacheWrite5m = t.cacheWrite5mTokens * perTok * CACHE_WRITE_5M_MULTIPLIER;
  const cacheWrite1h = t.cacheWrite1hTokens * perTok * CACHE_WRITE_1H_MULTIPLIER;

  return {
    input,
    output,
    cacheRead,
    cacheWrite5m,
    cacheWrite1h,
    total: input + output + cacheRead + cacheWrite5m + cacheWrite1h,
    priced: true,
  };
}

/** Share of spend that is input-side. The "89% of spend was input tokens" line. */
export function inputShare(c: CostBreakdown): number {
  if (c.total === 0) return 0;
  return (c.input + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h) / c.total;
}
