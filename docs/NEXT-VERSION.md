# v2 plan: real sign-in, live Linear sync, retire the seed array

Not yet built. This is the plan, scoped and reviewed with the user on
2026-08-08, for the next pass of work. See [ONBOARDING.md](./ONBOARDING.md)
for the audit that motivated it — this document covers the same three items
as tasks #2, #5 and #13 there, at implementation detail.

## Why

Aegis today has exactly one user (`DEMO_USER = "u_arun"`, hardcoded in three
files) and exactly one source of work units (the `SEEDS` literal in
`scripts/seed-work-units.ts`, 12 issues from one Linear workspace). Correct
for a five-hour build; it means nobody else can use the product. There's no
way to sign in as yourself, and no way to get *your* issues onto the board
short of editing TypeScript.

Scope decisions locked with the user:

- **Personal API key for Linear, not OAuth.** An OAuth app needs a Linear
  developer-console registration outside this repo and materially more code
  — token refresh, revocation, callback routes — for a v2 that doesn't need
  it yet.
- **Single shared board stays.** Sign-in gives real identity for `/me` and
  attribution ownership, but there is no org table and no per-team data wall
  yet. Everyone who signs in sees the same board and the same Linear
  connection. Full org isolation is separate follow-up work (tracked
  elsewhere as "add org tenancy"), not part of this pass.

One scope addition volunteered, not requested but load-bearing: sign-in is
useless without a way to mint your own machine key, so this plan also
replaces the DB-credentials-required `scripts/bootstrap.ts` flow with a
"Create key" action on `/settings/keys`, scoped to whoever is signed in.
Without it, real auth would exist but onboarding a laptop still wouldn't.

As a side effect, this closes the anonymous-access gap found during the
onboarding audit — `POST /api/attribute` had no caller-identity check, only
a check that the row belonged to the (hardcoded) demo user. Every
browser-facing route becomes sign-in gated.

## A. Authentication (Clerk)

- Add `@clerk/nextjs`. Provision `CLERK_SECRET_KEY` /
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Vercel Marketplace integration in
  prod, `.env.local` for dev).
- **`middleware.ts`** (new, repo root): `clerkMiddleware()`, protecting
  everything *except*:
  - `/api/ingest/sessions` — machine-to-server bearer auth
    (`Authorization: aegis_mk_...` against `machines.key_hash`), unrelated
    to human sign-in. Must stay reachable by the CLI client and the browser
    extension with no Clerk session.
  - `/api/webhooks/linear` — Linear's server calls this, no Clerk session
    either. Verified by HMAC signature instead (see §B).
  - Clerk's own routes and static assets.
- **`app/layout.tsx`**: wrap `<body>` in `<ClerkProvider>`; add `<UserButton
  />` to the header next to the nav links.
- **New**: `app/sign-in/[[...sign-in]]/page.tsx`,
  `app/sign-up/[[...sign-up]]/page.tsx` — thin wrappers around Clerk's
  `<SignIn />` / `<SignUp />`.
- **New**: `lib/auth.ts` — `requireUser()`. Calls `currentUser()` from
  `@clerk/nextjs/server`, then upserts a matching row into `aegis.users`
  (`id` = Clerk user id, `email`, `displayName`) so existing foreign keys
  (`machines.user_id`, `sessions.user_id`, `work_units.assignee_id`) keep
  working unchanged. This is the one place Clerk touches the data model.
- Replace every `DEMO_USER` usage with `requireUser()`:
  - `app/me/page.tsx:10` — scope the sessions query to the real id.
  - `app/me/chats/page.tsx:12` — same.
  - `app/api/attribute/route.ts:17,38` — authorize against the real id
    instead of a constant; 401 (not 403-after-a-DB-lookup) when signed out.
- **`app/settings/keys/page.tsx`**: scope the machine list to
  `requireUser()`'s id; add a "Create key" form/server action.
- **New**: `lib/machines.ts` — extract the key-generation logic
  (`aegis_mk_<random>`, sha256 hash, upsert row) out of
  `scripts/bootstrap.ts` into a shared `createMachineKey(userId, name)`.
  The UI action and `bootstrap.ts` both call it; `bootstrap.ts` becomes a
  thin CLI wrapper kept for local/dev convenience, no longer the only path.

## B. Live Linear sync

- **New table**, `db/schema.ts`, `aegis` schema — single-row in practice
  (matches "single shared board"):

  ```ts
  export const linearConnections = aegis.table("linear_connections", {
    id: text("id").primaryKey(),           // "default"
    apiKey: text("api_key").notNull(),     // server-only, never returned to the client
    workspaceName: text("workspace_name"),
    webhookId: text("webhook_id"),
    webhookSecret: text("webhook_secret"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  });
  ```

- **New**: `lib/linear.ts` — a small GraphQL client (`fetch` against
  `https://api.linear.app/graphql`) plus:
  - `verifyKey(apiKey)` — runs Linear's `viewer` query to validate the key
    and get the workspace name before saving anything.
  - `fetchAllIssues(apiKey)` — paginated `issues` query: `id`, `identifier`,
    `title`, `description`, `state { name }`, `estimate`, `team { key }`,
    `cycle { name }`, `assignee { id name email }`, `url`,
    `labels { nodes { name } }`, `createdAt`, `completedAt`.
  - `fetchIssue(apiKey, id)` — same shape, single issue, used by the
    webhook handler.
  - `upsertIssue(issue)` — normalizes into `work_units` and
    `onConflictDoUpdate`s on the existing `identifier` unique index,
    **listing only Linear-owned columns in `set`** (title, description,
    state, estimate, teamKey, cycleName, assigneeId, url, labels,
    createdAt, completedAt). `cohort` / `cohortRationale` are Aegis's own
    classifier fields and are deliberately left out of the `set` clause so
    a resync can never clobber them — the same shape as `keepIfHuman` in
    `app/api/ingest/sessions/route.ts`, just expressed as "don't list the
    column" instead of a `case when`. Also upserts a `users` row per
    distinct Linear assignee (`id` prefixed `li_<linearUserId>` to keep
    Linear-sourced identities distinct from Clerk-sourced ones).
  - **Header format note**: confirm at implementation time whether Linear's
    current API expects the personal key as a bare `Authorization` value or
    `Bearer <key>` — check the live Linear API docs, don't assume from
    training data.
- **New**: `app/settings/linear/page.tsx` — paste-a-key form when no
  connection exists; once connected, shows workspace name, last synced
  time, "Sync now", and "Disconnect". Add `{ href: "/settings/linear",
  label: "Linear" }` to the `NAV` array in `app/layout.tsx`.
- **New**: `app/api/linear/connect/route.ts` (POST) — `verifyKey`, then
  `webhookCreate` (Linear GraphQL mutation) pointed at
  `${origin}/api/webhooks/linear`, store the returned signing secret,
  run one immediate `fetchAllIssues` + `upsertIssue` pass so the board
  isn't empty while waiting on webhook traffic.
- **New**: `app/api/linear/sync/route.ts` (POST) — re-runs the full
  `fetchAllIssues` pass on demand, for the "Sync now" button and for local
  dev (where a Linear-hosted webhook can't reach `localhost`).
- **New**: `app/api/webhooks/linear/route.ts` (POST) — verify the
  `Linear-Signature` header (HMAC-SHA256 of the raw body with the stored
  webhook secret) before touching the body at all; on an `Issue` event,
  `fetchIssue` by id and `upsertIssue`. No Clerk session, excluded in
  `middleware.ts`, authenticated by signature instead — same shape as
  ingest's bearer-key auth, different mechanism.

## C. Retire the seed array

- Delete `scripts/seed-work-units.ts`.
- Remove the `"seed"` line from `package.json`.
- **Not doing**: purging the existing seeded rows (`BAT-8`..`BAT-19`,
  `is_seeded = true`) from the database. They carry genuine captured cost
  data documented in `CLAUDE.md` as intentionally kept for demo purposes,
  and the ask is to remove the *array* (the code path), not the historical
  rows. They sit alongside real synced issues, distinguished by `is_seeded`.

## Files touched, summary

| New | Changed | Deleted |
|---|---|---|
| `middleware.ts` | `app/layout.tsx` | `scripts/seed-work-units.ts` |
| `lib/auth.ts` | `app/me/page.tsx` | |
| `lib/machines.ts` | `app/me/chats/page.tsx` | |
| `lib/linear.ts` | `app/api/attribute/route.ts` | |
| `app/sign-in/[[...sign-in]]/page.tsx` | `app/settings/keys/page.tsx` | |
| `app/sign-up/[[...sign-up]]/page.tsx` | `scripts/bootstrap.ts` (refactor) | |
| `app/settings/linear/page.tsx` | `db/schema.ts` (+ `linearConnections`) | |
| `app/api/linear/connect/route.ts` | `package.json` (+`@clerk/nextjs`, −`seed`) | |
| `app/api/linear/sync/route.ts` | `.env.example` (+ Clerk keys, documented) | |
| `app/api/webhooks/linear/route.ts` | | |

Schema change applied with `pnpm db:push`, consistent with how every
existing table in this project reaches the database — no migration files
are checked in today, so this doesn't introduce a new pattern.

## Verification, once built

1. `pnpm build` clean, `pnpm test:extension` still 2/2 (neither package
   touches the extension).
2. Signed out: hitting `/`, `/me`, `/settings/keys`, or posting to
   `/api/attribute` redirects to sign-in / returns 401.
3. Sign in as a fresh Clerk user: `/me` shows zero sessions (not someone
   else's), `/settings/keys` shows zero machines, "Create key" mints one
   without ever touching `DATABASE_URL`.
4. `/settings/linear`: paste a real personal API key → workspace name
   appears → board at `/` populates from real issues within one sync.
   Edit an issue in Linear → webhook fires → `/` reflects it without a
   manual sync.
5. Manually set a `cohort` on a synced issue, then hit "Sync now" again —
   confirms the resync didn't clobber it (mirrors the existing `keepIfHuman`
   guarantee in the ingest path, invariant 6b in `CLAUDE.md`).
6. `BAT-8`..`BAT-19` still render on `/issues/[identifier]` with their
   existing cost data, undisturbed by the sync running for the first time.
