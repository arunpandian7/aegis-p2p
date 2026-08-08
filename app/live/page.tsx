"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stat, AttributionChip, usd } from "@/components/cost";

type Row = {
  id: string;
  repo: string | null;
  branch: string | null;
  surface: string;
  cost: number;
  messages: number;
  tools: number;
  method: string;
  confidence: string;
  startedAt: string;
  fresh: boolean;
};

type Payload = {
  now: number;
  totals: { cost: number; sessions: number; attributed: number };
  sessions: Row[];
};

/**
 * Live view. Polls rather than holding a stream: serverless instances do not
 * share memory, so a push channel would need a broker this does not need. The
 * database is authoritative and a 3s poll is indistinguishable on stage.
 */
export default function LivePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [since, setSince] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/recent?since=${since}`, { cache: "no-store" });
        const json: Payload = await res.json();
        if (cancelled) return;
        setData(json);
        setSince(json.now);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // `since` is intentionally excluded: including it would restart the
    // interval on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live</h1>
        <p className="mt-1 text-sm text-[var(--color-dim)]">
          Sessions as the collector sends them. Run a Claude Code session and watch it land.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total cost" value={data ? usd(data.totals.cost) : "—"} sub="all sessions" />
        <Stat label="Sessions" value={data ? String(data.totals.sessions) : "—"} />
        <Stat
          label="Attributed"
          value={data ? String(data.totals.attributed) : "—"}
          sub={
            data && data.totals.sessions > 0
              ? `${Math.round((data.totals.attributed / data.totals.sessions) * 100)}% of sessions`
              : undefined
          }
        />
      </div>

      {error ? (
        <p className="rounded border border-[var(--color-critical)]/40 px-3 py-2 text-sm text-[var(--color-critical)]">
          Poll failed: {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="flex items-center justify-between border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Most recent</h2>
          <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-good)]" />
            polling every 3s
          </span>
        </div>
        {!data ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">Connecting…</p>
        ) : (
          <ul className="divide-y divide-[var(--color-edge)]">
            {data.sessions.map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm ${
                  s.fresh ? "bg-[var(--color-good)]/10" : ""
                }`}
              >
                <Link href={`/sessions/${s.id}`} className="font-mono text-xs hover:underline">
                  {s.id.slice(0, 8)}
                </Link>
                <span className="text-xs text-[var(--color-muted)]">
                  {s.repo ?? "—"} · {s.branch ?? "no branch"} · {s.messages} msgs · {s.tools} tools
                </span>
                <AttributionChip method={s.method} confidence={s.confidence} />
                <span className="tabular ml-auto font-medium">{usd(s.cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
