import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { machines } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const db = getDb();
  const rows = await db.select().from(machines).orderBy(desc(machines.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Machine keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-dim)]">
          Each machine running the collector holds its own key. Only the hash is stored, so a key
          is unrecoverable after it is issued — rotate to replace one.
        </p>
      </div>

      <section className="rounded-lg border border-[var(--color-edge)]">
        <div className="border-b border-[var(--color-edge)] bg-[var(--color-surface)] px-4 py-3">
          <h2 className="font-medium">Registered machines</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">
            No machines yet. Run the bootstrap script to register one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-[var(--color-edge)] last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">{m.name}</span>
                    <div className="mt-0.5 font-mono text-xs text-[var(--color-muted)]">
                      {m.id}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                    key ···{m.keyHash.slice(-8)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[var(--color-muted)]">
                    {m.lastSeenAt
                      ? `last seen ${m.lastSeenAt.toISOString().replace("T", " ").slice(0, 16)}`
                      : "never connected"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-surface)] p-4">
        <h2 className="font-medium">Install the collector</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          It reads local Claude Code transcripts and posts them here. It keeps no cursor and
          replays whole sessions on every run — the server dedupes on{" "}
          <code className="font-mono">(session_id, seq)</code>, so re-running it is always safe.
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-black/40 p-3 font-mono text-xs leading-relaxed">
{`# register this machine and print its key (shown once)
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts

# then, on any machine:
export AEGIS_URL=https://your-deployment.vercel.app
export AEGIS_KEY=aegis_mk_...
pnpm client            # send
pnpm client --dry      # parse and summarise without sending`}
        </pre>
      </section>
    </div>
  );
}
