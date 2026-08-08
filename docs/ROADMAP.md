# Browser project tracking roadmap

This roadmap assumes the privacy posture in `AGENTS.md` remains the default: the user opts in, plaintext
conversation content stays in the page, web usage is estimated/pool data, and private activity is not a
team-surveillance feed.

## P0 — make the MVP trustworthy

### 1. Live adapter fixtures and smoke tests

- Verify current Claude project and non-project conversation routes.
- Verify current ChatGPT project and non-project conversation routes.
- Save only synthetic/sanitized HTML fragments as fixtures.
- Split provider adapters into testable pure modules.
- Expose a local extraction-debug view containing selector/version/status, never message text.

Why first: if project extraction drifts, every downstream chart is confidently wrong.

### 2. Real private-user boundary

- Add application login.
- Bind ingest machines to a user and scope `/me` queries to that identity.
- Add explicit personal/team publication controls; keep browser sessions private by default.
- Add delete/export controls for a user's captured metadata.

### 3. Harden ingestion

- Add runtime schema validation, length/count limits, and useful per-session rejection errors.
- Add machine-level rate limiting and key rotation/revocation.
- Configure allowed extension origins instead of wildcard CORS.
- Wrap session/event/tool/attribution writes in an atomic transaction where supported.
- Add a checked-in database migration for all new session columns and indexes.

### 4. Restore full CI confidence

- Install an approved, aged dependency set without bypassing package policy.
- Run TypeScript, Next build, extension unit tests, and schema checks in CI.
- Add a disposable Postgres integration test proving a growing chat updates rather than duplicates.

## P1 — improve usefulness without weakening privacy

### Better token estimates

- Store `estimatorName`, `estimatorVersion`, and an error/confidence band.
- Calibrate provider-specific local estimators against consented samples with authoritative counts.
- Prefer a local tokenizer where model/tokenization is known; keep a calibrated heuristic when the web
  UI does not expose the model.
- Never silently call a remote token-counting endpoint with conversation text. If offered, make that a
  separate explicit opt-in with a clear destination disclosure.

### Historical backfill

- Import user-requested Claude and ChatGPT data exports locally.
- Reuse the same provider/project/conversation contract as live capture.
- Hash and discard plaintext during import unless the user explicitly chooses encrypted retention.
- Show import provenance separately from extension capture.

### First-class projects

- Add a `provider_projects` table keyed by provider, account/workspace scope, and provider project ID.
- Track rename history and last observed URL/name.
- Let users map a provider project to a Linear issue, epic, repository, or internal work unit.
- Keep mapping confidence and actor in the audit trail.

### Engineer-confirmed attribution

- Suggest a work unit from project name/title and existing branch/issue context without uploading the
  full conversation.
- Require confirmation before a private chat contributes to a team work-unit roll-up.
- Make “personal / never publish” a first-class durable choice.

## P2 — expand coverage

- Firefox/WebExtension packaging.
- Enterprise compliance/analytics connectors where workspace administrators have legitimate access.
- Optional direct API usage ingestion with provider-reported tokens and `costBasis=dollars`.
- Workspace-aware account separation for people signed into multiple provider accounts.
- Offline queue with bounded exponential backoff and visible failure state.
- Signed extension releases and documented privacy/security review.

## Product ideas worth exploring

### Project burn map

Show which provider projects are growing fastest by conversations, messages, and estimated token band.
Avoid fake dollar precision on subscriptions.

### Cross-surface work ledger

Combine Claude Code, Claude web, ChatGPT web, and direct API activity under a confirmed work unit while
always displaying capture method and confidence mix.

### Project handoff digest

Generate an on-device metadata-only handoff: active conversations, last activity, unfiled threads, and
which work units still need confirmation. Any content summary requires a separate consent model.

### Unfiled-session inbox

Give the engineer a private inbox for conversations outside a project and offer one-click project/work
unit assignment. This creates useful structure without turning the tool into employee monitoring.

### Pool pressure, not fake spend

If a provider exposes legitimate subscription usage limits, show project share and burn direction as a
range. Do not convert estimated web tokens into marginal dollars.

### Estimator calibration dashboard

For users who also have authoritative API counts, compare estimated versus reported token ranges and
improve estimator versions transparently.

## Ideas to reject by default

- Ranking engineers by chat volume, token count, or estimated spend.
- Scraping cookies or replaying private provider APIs.
- Uploading full prompts/responses by default.
- Presenting subscription activity as precise API cost.
- Guessing a project from unrelated sidebar text when extraction confidence is low.
- Merging reported and estimated usage without a visible basis/confidence split.

## Useful schema direction

When the project model becomes first-class, prefer explicit provenance over overloaded fields:

```text
provider_project
  provider
  workspace_scope_hash
  external_project_id
  current_name
  first_seen_at
  last_seen_at

project_work_unit_mapping
  provider_project_id
  work_unit_id
  method          # explicit | suggested | imported
  confidence
  actor
  created_at
```

Do not use a project name as identity; names change and may collide.
