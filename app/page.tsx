import { listIssues, cohortBands, totals } from "@/lib/queries";
import { Stat, CostBar, OutlierTag, AttributionChip, usd, IssueLink } from "@/components/cost";

export const dynamic = "force-dynamic";

export default async function Board() {
  const [issues, bands, t] = await Promise.all([listIssues(), cohortBands(), totals()]);
  const max = Math.max(...issues.map((i) => i.costUsd), 0.01);
  const withSessions = issues.filter((i) => i.sessionCount > 0);
  const overP90 = withSessions.filter((i) => {
    const b = i.cohort ? bands[i.cohort] : undefined;
    return b && b.p90 > 0 && i.costUsd > b.p90;
  }).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cycle 1</h1>
        <p className="mt-1 text-sm text-[var(--color-dim)]">
          Every issue carries what it actually cost in agent tokens.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cycle cost" value={usd(t.cost)} sub="API consumption, real dollars" />
        <Stat label="Issues" value={String(issues.length)} sub={`${withSessions.length} with sessions`} />
        <Stat
          label="Sessions"
          value={String(t.sessions)}
          sub={`${t.attributed} attributed`}
        />
        <Stat
          label="Over cohort P90"
          value={String(overP90)}
          sub={overP90 ? "worth explaining" : "nothing anomalous"}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-edge)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <th className="px-4 py-2 font-medium">Issue</th>
              <th className="px-4 py-2 font-medium">Cohort</th>
              <th className="w-[26%] px-4 py-2 font-medium">Cost vs cohort band</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 font-medium">Attribution</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => {
              const band = i.cohort ? bands[i.cohort] : undefined;
              return (
                <tr
                  key={i.id}
                  className="border-b border-[var(--color-edge)] last:border-0 hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3">
                    <IssueLink identifier={i.identifier}>
                      <span className="tabular text-[var(--color-dim)]">{i.identifier}</span>{" "}
                      <span className="font-medium">{i.title}</span>
                    </IssueLink>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {i.state}
                      {i.sessionCount > 0
                        ? ` · ${i.sessionCount} session${i.sessionCount > 1 ? "s" : ""}`
                        : " · no agent sessions"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-dim)]">{i.cohort ?? "—"}</td>
                  <td className="px-4 py-3">
                    <CostBar
                      cost={i.costUsd}
                      p50={band?.p50 ?? 0}
                      p90={band?.p90 ?? 0}
                      max={max}
                    />
                    {band && band.p50 > 0 ? (
                      <div className="tabular mt-1 text-xs text-[var(--color-muted)]">
                        cohort P50 {usd(band.p50)} · P90 {usd(band.p90)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="tabular font-medium">{usd(i.costUsd)}</div>
                    <div className="mt-1 flex justify-end">
                      <OutlierTag cost={i.costUsd} p50={band?.p50 ?? 0} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {i.methods.length === 0 ? (
                        <AttributionChip method="none" confidence="none" />
                      ) : (
                        i.methods.map((m, idx) => (
                          <AttributionChip
                            key={m}
                            method={m}
                            confidence={i.confidences[idx] ?? "none"}
                          />
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-[var(--color-mark)]" />
          within cohort band
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-[var(--color-critical)]" />
          above cohort P90
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-[var(--color-band)]" />
          P50–P90 band
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-0.5 bg-[var(--color-text)]/70" />
          P90 threshold
        </span>
        <span>
          Bands are quantiles over the cohort, never a point estimate — the same agent on the
          same task can vary 30x.
        </span>
      </div>
    </div>
  );
}
