import Link from "next/link";

export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * A stat tile. No plot — a single number's job is to be read, and a chart
 * around it would only add ink.
 */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--color-dim)]">{sub}</div> : null}
    </div>
  );
}

/**
 * Cost against its cohort band.
 *
 * The band (P50→P90) is drawn as a recessive fill behind the bar, so "how far
 * outside normal" is read from geometry rather than from a number the reader
 * has to compute. Status color is applied only past P90, and always alongside
 * the multiplier label — the color never carries the meaning by itself.
 */
export function CostBar({
  cost,
  p50,
  p90,
  max,
}: {
  cost: number;
  p50: number;
  p90: number;
  max: number;
}) {
  const scale = (v: number) => (max <= 0 ? 0 : Math.min(100, (v / max) * 100));
  const overP90 = p90 > 0 && cost > p90;

  return (
    <div className="relative h-5 w-full overflow-hidden rounded bg-black/25">
      {/* Cohort band: where this kind of work normally lands. */}
      {p90 > 0 ? (
        <div
          className="absolute inset-y-0 bg-[var(--color-band)]"
          style={{ left: `${scale(p50)}%`, width: `${Math.max(scale(p90) - scale(p50), 0.6)}%` }}
          aria-hidden
        />
      ) : null}

      <div
        className="bar-end absolute inset-y-1 left-0"
        style={{
          width: `${Math.max(scale(cost), cost > 0 ? 1.5 : 0)}%`,
          background: overP90 ? "var(--color-critical)" : "var(--color-mark)",
        }}
      />

      {/*
       * Ticks render after the bar so they stay visible on top of it. P90 is
       * the threshold that decides "over", so it has to be readable even when
       * a long bar covers the band it belongs to.
       */}
      {p50 > 0 ? (
        <div
          className="absolute inset-y-0 w-px bg-[var(--color-muted)]"
          style={{ left: `${scale(p50)}%` }}
          aria-hidden
        />
      ) : null}
      {p90 > 0 ? (
        <div
          className="absolute inset-y-0 w-0.5 bg-[var(--color-text)]/70"
          style={{ left: `${scale(p90)}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

export function OutlierTag({ cost, p50 }: { cost: number; p50: number }) {
  if (p50 <= 0 || cost <= p50) return null;
  const multiple = cost / p50;
  if (multiple < 2) return null;
  return (
    <span className="whitespace-nowrap rounded border border-[var(--color-critical)]/40 px-1.5 py-0.5 text-xs font-medium text-[var(--color-critical)]">
      {multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}x median
    </span>
  );
}

/**
 * Attribution provenance. Direct, derived and tagged rows must never be summed
 * into one number without showing the mix, so the mix rides next to the total.
 */
const METHOD_LABEL: Record<string, string> = {
  explicit: "explicit",
  branch: "branch",
  pr: "PR",
  tagged: "tagged",
  allocated: "allocated",
  none: "unattributed",
};

export function AttributionChip({
  method,
  confidence,
}: {
  method: string;
  confidence: string;
}) {
  const tone =
    confidence === "high"
      ? "text-[var(--color-good)] border-[var(--color-good)]/35"
      : confidence === "medium"
        ? "text-[var(--color-warning)] border-[var(--color-warning)]/35"
        : confidence === "low"
          ? "text-[var(--color-serious)] border-[var(--color-serious)]/35"
          : "text-[var(--color-muted)] border-[var(--color-edge)]";

  return (
    <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${tone}`}>
      {METHOD_LABEL[method] ?? method}
      {confidence !== "none" ? ` · ${confidence}` : ""}
    </span>
  );
}

export function IssueLink({
  identifier,
  children,
}: {
  identifier: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={`/issues/${identifier}`} className="hover:underline">
      {children}
    </Link>
  );
}
