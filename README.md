# Aegis

Attributes every AI coding session to the unit of work that caused it, so a team
can see what a feature actually cost in tokens.

The product is the `session → work_unit` join. Not a spend dashboard, not a
Linear plugin.

- Background and positioning: [docs/Idea.md](docs/Idea.md)
- Routes and API contracts: [docs/PAGES.md](docs/PAGES.md)
- Decisions and their reasoning: [docs/DECISIONS.md](docs/DECISIONS.md)
- Working on the code: [CLAUDE.md](CLAUDE.md)

## Two collectors, two accounting bases

| | `client/` — Claude Code | `extension/` — Claude & ChatGPT web |
|---|---|---|
| Source | local JSONL transcripts | the rendered page, after you opt in |
| Tokens | provider-reported, per message | estimated from characters, one aggregate |
| `usage_basis` | `reported` | `estimated` |
| `cost_basis` | `dollars` | `pool` — never summed into a dollar total |
| Attribution | `branch` from `gitBranch`, Direct/High | `none` until you tag it yourself |
| Surface | `/me` → *My sessions* | `/me/chats` → *My chats* |

Web conversations produce counts, not costs. There is no per-session cost API for
claude.ai at any plan tier, and the cache read/write split that carries almost all
of a real session's cost is unrecoverable from rendered text — so Aegis labels
that activity pool consumption rather than inventing a dollar figure. ADR-0001
sets that rule; ADR-0002 records the conditions under which the browser collector
was allowed to exist at all.

## Run it

Requires Node 20+, pnpm, and a Postgres database.

```bash
cp .env.example .env.local          # fill in DATABASE_URL and ANTHROPIC_API_KEY
pnpm install
pnpm db:push
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/check-env.ts   # verify creds
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts   # prints an ingest key, once
pnpm dev
```

Then either collector:

```bash
# Claude Code transcripts
pnpm exec tsx client/index.ts --dry                                # parse only, no DB
pnpm exec dotenv -e .env.local -- pnpm exec tsx client/index.ts    # ingest
```

For the browser collector, load `extension/` unpacked — see
[extension/README.md](extension/README.md).

## Tests

```bash
pnpm build
pnpm test:extension
```
