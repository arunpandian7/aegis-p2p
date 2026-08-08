# Aegis

Attributes every AI coding session to the unit of work that caused it, so a team
can see what a feature actually cost in tokens.

The product is the `session → work_unit` join. Not a spend dashboard, not a
Linear plugin. Background and positioning: [docs/Idea.md](docs/Idea.md).
Routes and API contracts: [docs/PAGES.md](docs/PAGES.md). Decisions and their
reasoning: [docs/DECISIONS.md](docs/DECISIONS.md).

## Stack

Next.js 15 (App Router) · Drizzle · Supabase Postgres · Tailwind v4 ·
`@anthropic-ai/sdk`. Deployed on Vercel
(`arun-pandian-rs-projects/aegis-p2p` → <https://aegis-p2p.vercel.app>),
connected to the GitHub repo, so a push to `main` deploys.

**Use `pnpm`, never npm or npx.**

## Commands

```bash
pnpm dev                                                   # localhost:3000
pnpm build

pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/check-env.ts        # verify creds actually work
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts        # register a machine, print its key once
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-work-units.ts  # mirror Linear issues, link sessions
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/try-explain.ts      # explainer on the priciest session

pnpm exec tsx scripts/inspect-local.ts    # parse local transcripts, no DB
pnpm exec tsx scripts/inspect-signals.ts  # the digest the explainer receives

pnpm exec dotenv -e .env.local -- pnpm exec tsx client/index.ts   # ingest
pnpm exec tsx client/index.ts --dry                                # parse only

pnpm test:extension                       # browser collector unit tests, no deps needed

# needs `pnpm dev` running; creates and deletes its own machine and session
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/e2e-web-ingest.mts
```

Only Next.js auto-loads `.env.local`. Every script needs the `dotenv -e` prefix.

## Where the data comes from

Claude Code writes a JSONL transcript per session to
`~/.claude/projects/<slug>/<uuid>.jsonl`. Every row carries `sessionId`, `cwd`,
**`gitBranch`**, `timestamp` and `version`; assistant rows carry `message.model`
and `message.usage`.

**No OTel, no session-start hook, no `OTEL_RESOURCE_ATTRIBUTES`.** The branch is
already on every row, which is what makes Direct/High attribution possible with
nothing installed but the collector.

`client/parse.ts` is tolerant by design — transcripts contain many row types we
ignore and new ones appear between Claude Code releases. Unknown rows are
skipped, never treated as errors.

### The second collector: `extension/`

An opt-in Manifest V3 extension reads **claude.ai and chatgpt.com pages the
engineer already has open** and posts to the same ingest route. It exists under
terms recorded in **ADR-0002**; read that before widening what it captures.

It is a different kind of data and must stay one: no provider reports per-message
tokens on the web, so the collector counts messages and estimates
`ceil(chars / 4)`. Those rows are `usage_basis = 'estimated'`,
`cost_basis = 'pool'`, `is_private = true`, attribution `none`, and their model
string (`<provider>-web-unreported`) deliberately has **no rate in
`lib/pricing.ts`** — so `costOf()` returns zero and `priced: false`. A web chat
cannot contribute a dollar to anything by construction.

Plaintext never leaves the page. The content script reads message text only to
produce a count, an estimate and a SHA-256 change digest; the ingest key lives in
`TRUSTED_CONTEXTS` storage the content script cannot reach. `extension/test/`
asserts a message body cannot reach the payload even if one is handed to the
service worker by mistake.

Provider DOM is not a public API. When extraction fails, `content.js` sends
nothing rather than guessing from an unrelated element.

## Invariants — do not break these

**1. Cache creation is split by TTL.** `cache_creation.ephemeral_1h_input_tokens`
bills at **2.0×** the input rate; `ephemeral_5m` at **1.25×**; cache reads at
**0.1×**. A single `cached_tokens` column would make every number wrong by close
to an order of magnitude — on real sessions raw input is often under a cent
while cache traffic is the entire bill.

**2. Cost is priced against the event's own timestamp, never `now()`.** Rates
carry effective dates in `lib/pricing.ts` because they move — Sonnet 5 is on
introductory pricing until **2026-08-31**. A session replayed next month must
still cost what it cost.

**3. `cost_basis` separates dollars from pool.** API consumption is
`'dollars'`; seat-plan chat is `'pool'` and is never summed into a dollar total.
Enforced as a column, not a convention. `usage_basis` is the companion axis —
`'reported'` for provider-supplied token counts, `'estimated'` for anything the
browser collector derived from characters. Never render an estimated figure with
a dollar sign, and never put the two bases on one axis; `/me` and `/me/chats` are
separate routes for exactly this reason.

**4. Attribution always travels with its method and confidence.** Use
`confidenceMix()` before rendering any total. Direct, derived, tagged and
allocated rows must never collapse into one unqualified number.

**5. `is_private` is excluded in the queries, not the UI.** Every aggregate in
`lib/queries.ts` filters it. The privacy stance is a property of the SQL, which
is what makes it answerable when someone probes it.

**6. Ingest is idempotent on `(session_id, seq)`.** The client keeps no cursor
and replays whole transcripts every run. Anything added to the ingest path must
preserve that — it is why re-running the collector mid-demo is safe.

**6b. A replay refreshes measurements, never decisions.** Where a session already
carries `tagged` or `explicit`, its work unit, method, confidence and
`is_private` survive the upsert untouched, and no inferred attribution is
appended to the audit trail. An engineer's confirmation outranks anything we
infer — including on the second ingest.

**7. The explainer never generates a number.** `lib/signals.ts` computes; Claude
writes sentences around computed values. If you add a figure to the prose, add
it to the digest first.

**8. Cohort cost is a band, never a point.** `cohortBands()` returns P50/P90 and
there is deliberately no function returning a point estimate — the same agent on
the same task varies up to 30×.

## Things that surprised us

- `usage.iterations` exists but is always length 1 in real transcripts. It
  carries no retry signal in practice; don't build on it.
- `<synthetic>` is a real value of `message.model` — Claude Code's placeholder
  for a transcript row that was never an API call. It is priced at zero, not
  treated as unknown.
- The Bash tool's `target` needs `bashHead()`: a naive whitespace split mangles
  quoted paths, and `cd`-prefixes and `VAR=value` env assignments are noise that
  hide the command actually doing the work.
- There is **no session-level cost API for claude.ai chat** at any plan tier. See
  ADR-0001. Scraping and estimating chat *cost* remain rejected: the cache
  read/write split carries almost the whole bill and is unrecoverable from text,
  so any dollar figure would be confidently wrong. ADR-0002 later admitted a
  consented browser collector for **token and message counts only** — that is a
  narrow exception on volume, not a reopening of the cost question.

## Database

Supabase project `fabriciq-labs` (`crjvfpysdsgjckxzgeuw`), schema **`aegis`** —
*not* `public`, which holds an unrelated application including its own `users`
table. Teardown is `DROP SCHEMA aegis CASCADE`; nothing outside it was touched.

`DATABASE_URL` must be the **transaction pooler** string (port 6543). Drizzle is
configured with `prepare: false` because transaction-mode poolers cannot cache
prepared statements.

`db/index.ts` uses a plain lazy `let`, never a `Proxy` — a Proxy breaks
libraries that introspect the client, and lazy init keeps `next build` from
crashing before env is set.

## Demo data

Twelve seeded Linear issues (BAT-8 … BAT-19) live in a dedicated **Aegis Demo**
project inside the Batcave team, deletable as a group:
<https://linear.app/seyonix-tech/project/aegis-demo-231b790e8e0a>

Every token count, cost and tool trace attached to them is **genuine**, captured
from real sessions on this machine. Only the issue↔session mapping is authored —
which is exactly why those attributions are recorded as `tagged` (a human
asserted the link) and not `branch` (the system derived it). The real branches
are all `main`.
