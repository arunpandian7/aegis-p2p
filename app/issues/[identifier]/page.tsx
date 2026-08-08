import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { explanations, toolCalls } from "@/db/schema";
import { getIssue, sessionsForIssue, cohortBands } from "@/lib/queries";
import { confidenceMix } from "@/lib/attribution";
import { Stat, CostBar, OutlierTag, AttributionChip, usd } from "@/components/cost";
import { Explainer } from "@/components/explainer";

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const issue = await getIssue(identifier);
  if (!issue) notFound();

  const db = getDb();
  const [rows, bands, cached] = await Promise.all([
    sessionsForIssue(issue.id),
    cohortBands(),
    db
      .select()
      .from(explanations)
      .where(eq(explanations.workUnitId, issue.id))
      .orderBy(desc(explanations.createdAt))
      .limit(1),
  ]);

  const band = issue.cohort ? bands[issue.cohort] : undefined;
  const cost = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const mix = confidenceMix(rows);

  // Repeated targets across every session on this issue — the re-read signal.
  const repeats = new Map<string, number>();
  for (const s of rows) {
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.sessionId, s.id));
    for (const c of calls) {
      if (!c.target) continue;
      repeats.set(c.target, (repeats.get(c.target) ?? 0) + 1);
    }
  }
  const topRepeats = [...repeats.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-[var(--color-muted)] hover:underline">
          ← Cycle 1
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span className="tabular text-[var(--color-dim)]">{issue.identifier}</span>
          <h1 className="text-xl font-semibold tracking-tight">{issue.title}</h1>
          <OutlierTag cost={cost} p50={band?.p50 ?? 0} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <span>{issue.state}</span>
          {issue.cohort ? <span>cohort: {issue.cohort}</span> : null}
          {issue.estimate ? <span>{issue.estimate} points</span> : null}
          {issue.url ? (
            <a href={issue.url} target="_blank" rel="noreferrer" className="hover:underline">
              Open in Linear ↗
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Issue cost" value={usd(cost)} sub={`${rows.length} session(s)`} />
        <Stat
          label="Cohort P50"
          value={band ? usd(band.p50) : "—"}
          sub={band ? `P90 ${usd(band.p90)}` : "no cohort"}
        />
        <Stat
          label="Messages"
          value={String(rows.reduce((s, r) => s + r.messageCount, 0))}
          sub={`${rows.reduce((s, r) => s + r.toolCallCount, 0)} tool calls`}
        />
        <Stat
          label="Cost basis"
          value={rows.every((r) => r.costBasis === "dollars") ? "dollars" : "mixed"}
          sub="pool rows never sum in"
        />
      </div>

      {band ? (
        <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Against its cohort
          </div>
          <CostBar
            cost={cost}
            p50={band.p50}
            p90={band.p90}
            max={Math.max(cost, band.p90) * 1.1}
          />
          <div className="tabular mt-2 text-xs text-[var(--color-muted)]">
            P50 {usd(band.p50)} · P90 {usd(band.p90)} · this issue {usd(cost)}
          </div>
        </div>
      ) : null}

      <Explainer identifier={issue.identifier} cached={cached[0]?.body ?? null} />

      {topRepeats.length ? (
        <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-edge)] px-4 py-3">
            <h2 className="font-medium">Repeatedly touched</h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Targets the agent returned to three or more times.
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-edge)]">
            {topRepeats.map(([target, n]) => (
              <li key={target} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="tabular w-10 shrink-0 text-right text-[var(--color-dim)]">
                  {n}x
                </span>
                <span className="truncate font-mono text-xs text-[var(--color-text)]">
                  {target}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Sessions</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Attribution mix:{" "}
            {mix.map((m) => `${m.method}/${m.confidence} ${(m.share * 100).toFixed(0)}%`).join(" · ")}
          </p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-[var(--color-edge)] last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/sessions/${s.id}`} className="font-mono text-xs hover:underline">
                    {s.id.slice(0, 8)}
                  </Link>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {s.repo ?? "—"} · {s.gitBranch ?? "no branch"} · {s.messageCount} msgs
                  </div>
                </td>
                <td className="px-4 py-3">
                  <AttributionChip
                    method={s.attributionMethod}
                    confidence={s.attributionConfidence}
                  />
                </td>
                <td className="tabular px-4 py-3 text-right font-medium">
                  {usd(s.totalCostUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
