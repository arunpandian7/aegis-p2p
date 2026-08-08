import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession, eventsForSession, toolCallsForSession, getIssue } from "@/lib/queries";
import { computeSignals, type SessionLike } from "@/lib/signals";
import { Stat, AttributionChip, usd } from "@/components/cost";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const [events, tools] = await Promise.all([
    eventsForSession(session.id),
    toolCallsForSession(session.id),
  ]);

  const bySeq = new Map<number, { name: string; target: string | null }[]>();
  for (const t of tools) {
    const list = bySeq.get(t.eventSeq) ?? [];
    list.push({ name: t.name, target: t.target });
    bySeq.set(t.eventSeq, list);
  }

  const shaped: SessionLike = {
    sessionId: session.id,
    gitBranch: session.gitBranch,
    cwd: session.cwd,
    startedAt: session.startedAt.toISOString(),
    endedAt: (session.endedAt ?? session.startedAt).toISOString(),
    events: events.map((e) => ({
      seq: e.seq,
      ts: e.ts.toISOString(),
      model: e.model,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheWrite5mTokens: e.cacheWrite5mTokens,
      cacheWrite1hTokens: e.cacheWrite1hTokens,
      iterations: e.iterations,
      toolCalls: bySeq.get(e.seq) ?? [],
    })),
  };

  const sig = computeSignals([shaped]);
  const issue = session.workUnitId
    ? await getIssue(session.workUnitId.replace(/^wu_/, "").toUpperCase())
    : null;

  const peak = Math.max(...events.map((e) => e.costUsd), 0.0001);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-[var(--color-muted)] hover:underline">
          ← Cycle 1
        </Link>
        <h1 className="mt-2 font-mono text-lg font-semibold">{session.id}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <span>{session.repo ?? "—"}</span>
          <span>branch: {session.gitBranch ?? "none"}</span>
          <span>{session.surface}</span>
          {session.ccVersion ? <span>cc {session.ccVersion}</span> : null}
          <AttributionChip
            method={session.attributionMethod}
            confidence={session.attributionConfidence}
          />
          {issue ? (
            <Link href={`/issues/${issue.identifier}`} className="hover:underline">
              → {issue.identifier}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Session cost" value={usd(sig.cost.total)} sub={`${sig.messageCount} messages`} />
        <Stat
          label="Input share"
          value={`${sig.inputSharePct.toFixed(0)}%`}
          sub="of total spend"
        />
        <Stat
          label="Cache hit rate"
          value={`${sig.cacheHitRatePct.toFixed(0)}%`}
          sub="89–95% is healthy"
        />
        <Stat
          label="Duration"
          value={`${sig.durationMinutes.toFixed(0)}m`}
          sub={`${sig.toolCallCount} tool calls`}
        />
      </div>

      <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Where the money went
        </div>
        <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
          {[
            ["Input", sig.cost.input],
            ["Cache read", sig.cost.cacheRead],
            ["Cache write (5m)", sig.cost.cacheWrite5m],
            ["Cache write (1h)", sig.cost.cacheWrite1h],
            ["Output", sig.cost.output],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted)]">{label as string}</dt>
              <dd>{usd(value as number)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Cache creation is split by TTL because the rates differ — 1h bills at 2.0x the input
          rate, 5m at 1.25x.
        </p>
      </section>

      {sig.repeatedTargets.length ? (
        <section className="rounded-lg border border-[var(--color-edge)]">
          <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
            <h2 className="font-medium">Repeatedly touched</h2>
          </div>
          <ul className="divide-y divide-[var(--color-edge)]">
            {sig.repeatedTargets.map((r) => (
              <li key={r.target} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="tabular w-10 shrink-0 text-right text-[var(--color-dim)]">
                  {r.count}x
                </span>
                <span className="w-24 shrink-0 text-xs text-[var(--color-muted)]">
                  {r.tools.join("/")}
                  {r.longestStreak >= 3 ? ` · ${r.longestStreak} in a row` : ""}
                </span>
                <span className="truncate font-mono text-xs">{r.target}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Message timeline</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Bar length is that message&apos;s share of the most expensive one.
          </p>
        </div>
        <ul className="max-h-96 divide-y divide-[var(--color-edge)] overflow-y-auto">
          {events.map((e) => {
            const calls = bySeq.get(e.seq) ?? [];
            return (
              <li key={e.seq} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                <span className="tabular w-8 shrink-0 text-right text-[var(--color-muted)]">
                  {e.seq}
                </span>
                <span className="h-2 w-24 shrink-0 overflow-hidden rounded-sm bg-black/30">
                  <span
                    className="bar-end block h-full bg-[var(--color-mark)]"
                    style={{ width: `${Math.max((e.costUsd / peak) * 100, 2)}%` }}
                  />
                </span>
                <span className="tabular w-16 shrink-0 text-right">{usd(e.costUsd)}</span>
                <span className="truncate text-[var(--color-muted)]">
                  {calls.length
                    ? calls.map((c) => c.target ?? c.name).join(", ")
                    : "no tool calls"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
