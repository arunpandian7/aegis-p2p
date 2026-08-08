import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, workUnits } from "@/db/schema";
import { Stat, AttributionChip, usd } from "@/components/cost";
import { AttributeRow } from "@/components/attribute-row";

export const dynamic = "force-dynamic";

const DEMO_USER = "u_arun";

export default async function MePage() {
  const db = getDb();
  const rows = await db
    .select({
      id: sessions.id,
      repo: sessions.repo,
      gitBranch: sessions.gitBranch,
      startedAt: sessions.startedAt,
      cost: sessions.totalCostUsd,
      messages: sessions.messageCount,
      isPrivate: sessions.isPrivate,
      method: sessions.attributionMethod,
      confidence: sessions.attributionConfidence,
      workUnitId: sessions.workUnitId,
      identifier: workUnits.identifier,
      title: workUnits.title,
    })
    .from(sessions)
    .leftJoin(workUnits, eq(sessions.workUnitId, workUnits.id))
    .where(eq(sessions.userId, DEMO_USER))
    .orderBy(desc(sessions.startedAt));

  const untagged = rows.filter((r) => !r.workUnitId && !r.isPrivate);
  const personal = rows.filter((r) => r.isPrivate);
  const attributed = rows.filter((r) => r.workUnitId);
  const personalCost = personal.reduce((s, r) => s + r.cost, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My sessions</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-dim)]">
          Yours to attribute. Nothing here is attributed without you confirming it, and anything
          you mark personal stays out of every rollup on the team board — not hidden in the UI,
          excluded from the queries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Needs attribution" value={String(untagged.length)} sub="waiting on you" />
        <Stat label="Attributed" value={String(attributed.length)} sub="on the team board" />
        <Stat
          label="Personal"
          value={String(personal.length)}
          sub={personal.length ? `${usd(personalCost)}, never rolled up` : "none marked"}
        />
        <Stat
          label="Your total"
          value={usd(rows.reduce((s, r) => s + r.cost, 0))}
          sub="across every session"
        />
      </div>

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Needs attribution</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Claude proposes a match from the files and commands the session touched. You decide.
          </p>
        </div>
        {untagged.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">
            Nothing waiting. New sessions land here as they arrive.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-edge)]">
            {untagged.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link href={`/sessions/${r.id}`} className="font-mono text-xs hover:underline">
                      {r.id.slice(0, 8)}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {r.repo ?? "—"} · {r.gitBranch ?? "no branch"} · {r.messages} msgs ·{" "}
                      {r.startedAt.toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <span className="tabular text-sm font-medium">{usd(r.cost)}</span>
                </div>
                <AttributeRow sessionId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Attributed</h2>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {attributed.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-edge)] last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/sessions/${r.id}`} className="font-mono text-xs hover:underline">
                    {r.id.slice(0, 8)}
                  </Link>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {r.repo ?? "—"} · {r.messages} msgs
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {r.identifier ? (
                    <Link href={`/issues/${r.identifier}`} className="hover:underline">
                      <span className="tabular text-[var(--color-dim)]">{r.identifier}</span>{" "}
                      {r.title}
                    </Link>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <AttributionChip method={r.method} confidence={r.confidence} />
                </td>
                <td className="tabular px-4 py-2.5 text-right font-medium">{usd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {personal.length ? (
        <section className="rounded-lg border border-[var(--color-edge)]">
          <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
            <h2 className="font-medium">Personal</h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Visible only to you. Excluded from every team aggregate.
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-edge)]">
            {personal.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-[var(--color-muted)]">
                  {r.id.slice(0, 8)} · {r.repo ?? "—"}
                </span>
                <span className="tabular">{usd(r.cost)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
