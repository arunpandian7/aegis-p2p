# Aegis agent guide

## Mission

Aegis joins AI activity to the work that caused it. This branch adds a hackathon-quality, opt-in
browser collector for Claude and ChatGPT projects. Preserve the distinction between authoritative API
usage and estimated web-subscription activity.

Read these before changing the collector:

1. [`README.md`](README.md) — setup and user-facing behavior.
2. [`docs/HANDOFF.md`](docs/HANDOFF.md) — architecture, data flow, REST contract, and known gaps.
3. [`docs/ROADMAP.md`](docs/ROADMAP.md) — prioritized follow-up work and product ideas.
4. [`docs/Idea.md`](docs/Idea.md) — original product thesis and hackathon framing.

## Repository map

- `extension/` — unpacked Chromium Manifest V3 extension.
- `extension/content.js` — provider URL/DOM adapters, message counting, token estimation, digesting.
- `extension/service-worker.js` — consent gate, trusted key storage, dedupe, REST payload construction.
- `app/api/ingest/sessions/route.ts` — authenticated idempotent ingestion endpoint.
- `db/schema.ts` — canonical sessions, usage events, attribution, and project metadata.
- `app/me/page.tsx` — private/single-user project roll-up for the hackathon.
- `client/` — the pre-existing Claude Code transcript collector; do not regress it.
- `lib/projects.ts` — provider-neutral project aggregation.

## Non-negotiable invariants

- Capture remains disabled until the user checks the consent control.
- A content script may read rendered messages transiently to count and hash them, but plaintext prompts
  and responses must not enter extension storage, logs, REST payloads, or the database by default.
- Never extract or transmit Claude/ChatGPT cookies, authentication tokens, passwords, or site storage.
- Treat project names, conversation titles, URLs, IDs, and content-derived hashes as sensitive metadata.
- Strip URL query strings and fragments before upload.
- Browser-web data must remain `usageBasis=estimated`, `costBasis=pool`, and `isPrivate=true` unless a
  later feature has an explicit, reviewed consent and accounting model.
- Do not present estimated web usage as billed dollars or provider-reported tokens.
- Keep replay idempotency: Aegis session ID is `web:<provider>:<conversationId>` and the aggregate web
  usage event stays at `seq=0` until the event model is intentionally redesigned.
- Preserve provider-native project and conversation IDs; do not make names the primary identity.
- Do not break whole-transcript replay from the existing Claude Code client.

## Commands

```bash
pnpm install
pnpm db:push
pnpm machine:create -- --name "browser collector"
pnpm dev
pnpm test:extension
pnpm build
```

Checks that do not require installed dependencies:

```bash
node --test extension/test/*.test.mjs
for file in extension/*.js; do node --check "$file"; done
node -e 'JSON.parse(require("fs").readFileSync("extension/manifest.json", "utf8"))'
git diff --check
```

## Development workflow

1. Keep provider-specific DOM logic in `extension/content.js`; keep networking and credentials in the
   service worker.
2. Add sanitized DOM fixtures before widening selectors. Never use captured real conversations as
   committed fixtures.
3. Update the schema and ingest contract together. This prototype currently uses `drizzle-kit push`, so
   add formal migrations before supporting shared production databases.
4. Test both an unchanged replay and a growing conversation. A replay must update counts without
   duplicating the session, event, tools, or attribution audit entry.
5. Perform a logged-in manual smoke test on both providers after selector changes.
6. Document any newly collected field in the consent UI, extension README, and handoff data inventory.

## Current safety boundary

This remains a single-user hackathon prototype. The `/me` page has no application login, and the ingest
route uses permissive CORS for unpacked extension development. Run locally or behind external access
control until authentication, per-user query scoping, rate limiting, and an origin allowlist land.

Dependency installation was blocked in the original development environment by a minimum package-age
policy affecting the existing lockfile. Standalone extension checks pass, but the next agent must run a
full TypeScript/Next build once the approved dependency set can be installed.
