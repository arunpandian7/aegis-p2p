/**
 * Mirrors the seeded Linear issues into work_units and attaches the real
 * sessions already in the database.
 *
 * The issue records are held here rather than fetched live so the demo has no
 * runtime dependency on the Linear API. The URLs are real and clickable; the
 * project is https://linear.app/seyonix-tech/project/aegis-demo-231b790e8e0a
 * and can be deleted wholesale afterwards.
 *
 * Honesty note: every token count, cost and tool trace attached to these
 * issues is genuine, captured from real sessions on this machine. The only
 * authored part is which session belongs to which issue — which is why these
 * attributions are recorded as `tagged` (a human asserted the link), not
 * `branch` (the system derived it). The real branches are all `main`.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-work-units.ts
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { workUnits, sessions, attributions } from "../db/schema";

const TEAM = "BAT";
const BASE = "https://linear.app/seyonix-tech/issue";

type Seed = {
  identifier: string;
  title: string;
  slug: string;
  state: string;
  estimate: number;
  cohort: string;
  /** Session IDs attributed to this issue. */
  sessionIds: string[];
};

const SEEDS: Seed[] = [
  {
    identifier: "BAT-8",
    title: "Résumé PDF build fails after LaTeX class refactor",
    slug: "resume-pdf-build-fails-after-latex-class-refactor",
    state: "Done",
    estimate: 3,
    cohort: "document-pipeline",
    sessionIds: ["ab0dd123-94b4-43d7-aa7f-502b7a6752a2"],
  },
  {
    identifier: "BAT-9",
    title: "Add role-specific variant to document template",
    slug: "add-role-specific-variant-to-document-template",
    state: "Done",
    estimate: 2,
    cohort: "document-pipeline",
    sessionIds: ["121a63d1-2ff3-4ecf-a9a6-354152b4b7a2"],
  },
  {
    identifier: "BAT-10",
    title: "Fix font fallback in PDF export",
    slug: "fix-font-fallback-in-pdf-export",
    state: "Done",
    estimate: 1,
    cohort: "document-pipeline",
    sessionIds: ["07e7bd47-ecc1-4def-ada4-3ffb83dd20b4"],
  },
  {
    identifier: "BAT-11",
    title: "Tighten spacing in experience section",
    slug: "tighten-spacing-in-experience-section",
    state: "Done",
    estimate: 1,
    cohort: "document-pipeline",
    sessionIds: ["21a5bedd-58bf-4b35-a7c6-c51bdc4c9efb"],
  },
  {
    identifier: "BAT-12",
    title: "Build session ingestion pipeline with idempotent replay",
    slug: "build-session-ingestion-pipeline-with-idempotent-replay",
    state: "In Progress",
    estimate: 5,
    cohort: "data-pipeline",
    sessionIds: ["5f37b562-fea1-4fa6-89fd-25963bee78a3"],
  },
  {
    identifier: "BAT-13",
    title: "Design cost attribution schema with confidence tiering",
    slug: "design-cost-attribution-schema-with-confidence-tiering",
    state: "Done",
    estimate: 5,
    cohort: "data-pipeline",
    sessionIds: ["6b4c482d-87bd-4a4b-aafa-e1105f7d85d1"],
  },
  {
    identifier: "BAT-14",
    title: "Wire up data sync for the KeyTech app",
    slug: "wire-up-data-sync-for-the-keytech-app",
    state: "Done",
    estimate: 5,
    cohort: "data-pipeline",
    sessionIds: ["60c5769f-6547-49e8-b9ab-c231942736e8"],
  },
  {
    identifier: "BAT-15",
    title: "Investigate intermittent sync timeout",
    slug: "investigate-intermittent-sync-timeout",
    state: "Done",
    estimate: 2,
    cohort: "data-pipeline",
    sessionIds: ["54e36703-c8fa-4794-8582-4a7b03b4cbea"],
  },
  {
    identifier: "BAT-16",
    title: "Align button heights in the filter bar",
    slug: "align-button-heights-in-the-filter-bar",
    state: "Done",
    estimate: 1,
    cohort: "ui-tweak",
    sessionIds: [],
  },
  {
    identifier: "BAT-17",
    title: "Empty state copy for the saved-listings view",
    slug: "empty-state-copy-for-the-saved-listings-view",
    state: "Done",
    estimate: 1,
    cohort: "ui-tweak",
    sessionIds: [],
  },
  {
    identifier: "BAT-18",
    title: "Dark mode contrast pass on secondary text",
    slug: "dark-mode-contrast-pass-on-secondary-text",
    state: "Todo",
    estimate: 1,
    cohort: "ui-tweak",
    sessionIds: [],
  },
  {
    identifier: "BAT-19",
    title: "Truncate long titles in the list row",
    slug: "truncate-long-titles-in-the-list-row",
    state: "Todo",
    estimate: 1,
    cohort: "ui-tweak",
    sessionIds: [],
  },
];

async function main() {
  const db = getDb();
  let linked = 0;
  let missing = 0;

  for (const s of SEEDS) {
    const id = `wu_${s.identifier.toLowerCase()}`;
    const row = {
      id,
      identifier: s.identifier,
      title: s.title,
      description: null,
      state: s.state,
      estimate: s.estimate,
      teamKey: TEAM,
      cycleName: "Cycle 1",
      assigneeId: "u_arun",
      url: `${BASE}/${s.identifier}/${s.slug}`,
      labels: [s.cohort],
      cohort: s.cohort,
      cohortRationale: null,
      isSeeded: true,
      createdAt: new Date("2026-08-08T00:00:00Z"),
      completedAt: s.state === "Done" ? new Date("2026-08-08T00:00:00Z") : null,
    };

    await db.insert(workUnits).values(row).onConflictDoUpdate({ target: workUnits.id, set: row });

    for (const sessionId of s.sessionIds) {
      const [existing] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!existing) {
        console.warn(`  ! session ${sessionId.slice(0, 8)} not ingested yet — skipping`);
        missing++;
        continue;
      }

      await db
        .update(sessions)
        .set({
          workUnitId: id,
          // `tagged`, not `branch`: a human asserted this link. The real
          // branches are all `main`, and claiming otherwise would be a lie
          // the confidence column exists precisely to prevent.
          attributionMethod: "tagged",
          attributionConfidence: "high",
        })
        .where(eq(sessions.id, sessionId));

      await db.insert(attributions).values({
        sessionId,
        workUnitId: id,
        method: "tagged",
        confidence: "high",
        actor: "u_arun",
        rationale: `Confirmed by the engineer during demo seeding on ${new Date()
          .toISOString()
          .slice(0, 10)}.`,
      });

      linked++;
    }
  }

  const [summary] = await db
    .select({
      issues: sql<number>`(select count(*) from ${workUnits})`,
      attributed: sql<number>`count(*) filter (where ${sessions.workUnitId} is not null)`,
      unattributed: sql<number>`count(*) filter (where ${sessions.workUnitId} is null)`,
      total: sql<number>`round(sum(${sessions.totalCostUsd})::numeric, 2)`,
    })
    .from(sessions);

  console.log(
    `${SEEDS.length} work units · ${linked} sessions linked` +
      (missing ? ` · ${missing} missing` : ""),
  );
  console.log(
    `db: ${summary.issues} issues, ${summary.attributed} attributed / ` +
      `${summary.unattributed} unattributed sessions, $${summary.total} total`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
