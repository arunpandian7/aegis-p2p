# Getting from demo to onboardable

Assessment date: **2026-08-08**, against `91b806d`.

This document answers three questions: is the thing good, who can use it today,
and what has to be true before a second team can. It is deliberately separate
from [ROADMAP.md](./ROADMAP.md), which scopes the browser collector. This one
scopes the product.

## What is genuinely strong

The parts that are hard to copy are the parts that are done.

- **The thesis is load-bearing and it is proven on real data.** Cache traffic
  carries almost the entire bill; raw input tokens are noise. `/sessions/[id]`'s
  *Where the money went* panel is the argument, and it is built on genuine
  captured sessions rather than invented ones.
- **The accounting distinctions are enforced by columns, not by discipline.**
  `cost_basis`, `usage_basis`, `attribution_method` and `attribution_confidence`
  all travel with the row. A web chat cannot contribute a dollar because its
  model string has no rate in `lib/pricing.ts` — absence of a rate is the
  enforcement mechanism, which is the right kind of design.
- **Attribution is prefix-agnostic already.** `lib/attribution.ts` matches any
  `[A-Z][A-Z0-9]{1,9}-\d+` and excludes trunk branches, so it works for a team
  using `ACME-` on day one with nothing configured.
- **The privacy posture is written into the SQL.** Every aggregate in
  `lib/queries.ts` filters `is_private`. That is what makes the stance answerable
  when someone probes it, which they will.
- **Invariant 6b is a real insight.** "A replay refreshes measurements, never
  decisions" is the kind of rule you only find by shipping, and
  `scripts/e2e-web-ingest.mts` proves it rather than asserting it.
- **The explainer's constraint is the right one.** `lib/signals.ts` computes,
  Claude narrates. That is why it is cheap, fast and safe on a screen.

Health at time of writing: `pnpm build` is clean, `pnpm test:extension` passes
2/2, every route in [PAGES.md](./PAGES.md) renders.

## Who can use it today

**One person: the author, on one machine, against one seeded Linear project.**

Not as a criticism — it was built in five hours for a demo and it is an
excellent demo. But the gap between that and "a team can onboard" is not polish,
it is three structural absences:

1. **There is no identity.** `const DEMO_USER = "u_arun"` appears in
   `app/me/page.tsx:10`, `app/me/chats/page.tsx:12` and
   `app/api/attribute/route.ts:17`, and `scripts/bootstrap.ts:14` hardcodes the
   same id. There is no `middleware.ts` and no cookie or session handling
   anywhere in `app/` or `lib/`.
2. **There is no tenancy.** `listIssues()` selects all work units; `totals()`
   sums all non-private sessions; `recentSessions()` returns all rows. A second
   team pointing a collector at the same instance lands in the first team's
   numbers.
3. **There is no way to get work units in.** Grep for `linear` finds comments
   and URLs, no API code. `work_units` is populated only by the 12-issue `SEEDS`
   literal in `scripts/seed-work-units.ts`, hardcoded to team `BAT` and one
   Linear workspace. The product *is* the `session → work_unit` join, and the
   `work_unit` half arrives by editing TypeScript.

### The live exposure

Verified against `https://aegis-p2p.vercel.app` on 2026-08-08:

| Probe | Result |
|---|---|
| `GET /` | 200, anonymous |
| `GET /me` — the private surface | 200, anonymous |
| `GET /settings/keys` | 200, anonymous |
| `GET /api/recent?since=0` | 200, returns session ids, repo, branch, cost |
| `POST /api/attribute` with an unknown id | `404 unknown session` — **not 401** |

That last row is the finding. The 404 means the request reached the database
lookup with no credentials, so the `session.userId !== DEMO_USER` check at
`app/api/attribute/route.ts:38` is an assertion about the *row*, never about the
*caller*. Chained with `/api/recent`, which hands out real session ids
unauthenticated, an anonymous request can:

- `{action:"private"}` — detach a session from its work unit, silently changing
  the board;
- `{action:"confirm"}` — publish a session marked private to a team surface,
  which is precisely the boundary ADR-0002 §5 promises to hold;
- `{action:"suggest"}` — trigger an unmetered `claude-opus-5` call, once per
  request, on the project's `ANTHROPIC_API_KEY`.

Vercel deployment protection is the one-toggle mitigation. Task #1.

## Task items

Ordered. Everything in P0 blocks the second user; nothing in P2 does.

### P0 — before anyone else logs in

1. **Turn on Vercel deployment protection.** Immediate, reversible, buys time
   for the rest.
2. **Replace `DEMO_USER` with real authentication.** Clerk via the Vercel
   Marketplace is the native path. One server-side `currentUser()` helper that
   every route reads. Planned in detail in
   [NEXT-VERSION.md](./NEXT-VERSION.md) §A, alongside self-serve key issuance
   (task 7) since sign-in is not useful without it.
3. **Authorise `/api/attribute` against the signed-in user.** And rate-limit
   `suggest`, which is a cost-amplification endpoint by shape.
4. **Add org tenancy.** An `orgs` table, `org_id` on `work_units`, `sessions`
   and `machines`, filtered in the SQL — the same way `is_private` is, and for
   the same reason.

### P1 — before a team can self-serve

5. **Live Linear integration.** Personal API key (not OAuth, for now), issue
   sync, webhook. The single biggest blocker. Planned in detail in
   [NEXT-VERSION.md](./NEXT-VERSION.md) §B, which also retires the `SEEDS`
   literal in `scripts/seed-work-units.ts` (§C).
6. **Handle branch keys that match no work unit.** `route.ts:149-156` leaves
   `workUnitId` null on a miss but still stores `branch`/`high` at line 233. For
   a team with no issues synced, that is every session: a high-confidence
   attribution pointing at nothing, rendering nowhere.
7. **Self-serve machine keys from `/settings/keys`.** Today a key requires
   production `DATABASE_URL` and a repo clone, so only a DBA can onboard a
   laptop.
8. **Ship the collector as an installable command.** Onboarding an engineer
   currently means cloning the product.
9. **First-run empty state and checklist.** Connect Linear → register a machine
   → run the collector → see your first session, with live status per step.

### P2 — correctness and hygiene found during this pass

10. **Fix the dead `surface = 'chat'` filter.** `lib/queries.ts:44` filters on a
    value no writer ever sets — real values are `claude_code`, `claude_web`,
    `chatgpt_web` — so `chatCostUsd` is structurally always zero. Both it and
    `claudeCodeCostUsd` are unused outside `lib/queries.ts`, meaning the board's
    headline "split Claude Code vs chat" from [Idea.md](./Idea.md) §6 is not
    implemented. Any split must be tokens-for-web and dollars-for-code; web rows
    are pool basis and priced at zero, so a dollar split would read as free.
11. **Remove or scope `unattributedSessions()`.** `lib/queries.ts:187` filters
    neither owner nor `is_private`. Currently dead code, and a latent breach of
    invariant 5 the moment something calls it.
12. **Harden ingest.** Runtime validation, payload caps, per-machine rate limits,
    key revocation. Carried from ROADMAP P0 §3.
13. **Fix `pnpm seed`.** It points at `scripts/seed.ts`, which does not exist;
    the real file is `scripts/seed-work-units.ts`. Promote the `check-env`,
    `bootstrap` and `e2e` incantations to named scripts while there.
14. **Add CI.** A push to `main` deploys to production and nothing gates it.
    Build, typecheck, extension tests, plus a disposable-Postgres test for
    idempotency and invariant 6b.
15. **Export and delete controls.** Aegis asks engineers to opt a browser
    collector into reading their pages on the promise this is participation, not
    surveillance. Without "show me everything you hold and delete it" that
    promise is not checkable — and it is the question that decides whether
    engineers opt in at all.

## The strategic question the tasks do not settle

[Idea.md](./Idea.md) §7 flags an ICP conflict and it is still the live one:
Enterprise plans have the APIs but slow sales; small teams are reachable but
have no chat data source. The browser collector (ADR-0002) was the answer to the
second half, and it works — but it produces `estimated`/`pool` counts, never
dollars, so the small-team version of Aegis cannot show cost per feature in
dollars for chat. It can for Claude Code.

That is worth stating plainly before onboarding anyone: **for a small team,
Aegis measures Claude Code in dollars and everything else in volume.** That is
still a thing nobody else ships. It is just not the same sentence as the pitch.
