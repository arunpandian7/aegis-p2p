# Browser project tracking handoff

## Status at handoff

Merged from `agent/web-project-tracker` (PR #1). The terms it was admitted under are
[ADR-0002](DECISIONS.md); read that before widening what the collector captures.

The feature is implemented as a hackathon MVP, but it has not yet received a live logged-in DOM smoke
test against Claude and ChatGPT. It automatically tracks an open conversation after one-time consent,
upserts a privacy-limited session through the existing REST ingest route, and groups private web
sessions by provider project at `/me/chats`.

`/me` is untouched by this work: it remains the API-priced attribution surface (suggest → confirm →
mark personal), and web chats are a separate route because they carry a different accounting basis.

The implementation deliberately does **not** obtain or reuse Claude/ChatGPT login sessions. It operates
only on the rendered DOM of pages the user has already opened.

## End-to-end flow

```text
claude.ai / chatgpt.com
        |
        | rendered messages after consent
        v
extension/content.js
  - provider/project/conversation detection
  - message count and characters/4 estimate
  - SHA-256 change digest
        |
        | metadata snapshot (no message plaintext)
        v
extension/service-worker.js
  - trusted storage for ingest key
  - unchanged-chat dedupe
  - REST payload construction and retry-on-next-scan behavior
        |
        | POST /api/ingest/sessions + Bearer key
        v
Next ingest route
  - key authentication
  - session/event upsert
  - attribution audit dedupe
        |
        v
Postgres sessions + usage_events
        |
        v
/me/chats provider/project roll-up
```

## What is uploaded

| Group | Fields |
|---|---|
| Collector | Configured machine/collector name; ingest key in the Authorization header |
| Provider | `anthropic` or `openai`; `claude_web` or `chatgpt_web` surface |
| Project | Provider-native project ID/slug and project name, when detected |
| Conversation | Namespaced Aegis ID, provider conversation ID, title, canonical URL |
| Activity | Message count, first observed/message timestamp, capture timestamp |
| Usage | Approximate user/input and assistant/output tokens using `ceil(characters / 4)` |
| Change detection | SHA-256 digest covering roles/text, title, and project placement |
| Accounting labels | `captureMethod=extension`, `usageBasis=estimated`, `costBasis=pool`, `isPrivate=true` |

The hash is not plaintext, but it is still a content-derived fingerprint and must be treated as
sensitive metadata. Project names and conversation titles may also reveal user information.

## What remains in extension-local storage

- Aegis URL, ingest key, collector name, and enabled state.
- Per-conversation content hash, first-seen timestamp, and last successful sync timestamp.
- Latest provider/project/title/count plus sync status or error for the popup.

`chrome.storage.local` is restricted to trusted extension contexts. The content script can only ask the
service worker for the boolean capture-enabled state.

## What is not persisted or uploaded

- Plaintext prompts and assistant responses.
- Claude/ChatGPT cookies, passwords, authentication/session tokens, or site local storage.
- Attachment binaries.
- Account email/name.
- Browser history outside the two declared provider origins.
- An exact model, authoritative tokens, or subscription cost.

Rendered message text is necessarily read transiently inside the page to produce counts and the digest.
Anything inside a selected message element, including rendered code, can influence those derived values.

## REST contract used by the extension

```http
POST {AEGIS_URL}/api/ingest/sessions
Authorization: Bearer aegis_mk_...
Content-Type: application/json
```

Representative payload:

```json
{
  "machine": "browser-extension",
  "sessions": [
    {
      "sessionId": "web:openai:conversation-123",
      "provider": "openai",
      "surface": "chatgpt_web",
      "externalProjectId": "g-p-project-id",
      "externalProjectName": "Hackathon",
      "externalConversationId": "conversation-123",
      "externalConversationUrl": "https://chatgpt.com/g/g-p-project-id/c/conversation-123",
      "conversationTitle": "Launch plan",
      "captureMethod": "extension",
      "usageBasis": "estimated",
      "contentHash": "<sha256>",
      "startedAt": "2026-08-08T08:00:00.000Z",
      "endedAt": "2026-08-08T08:10:00.000Z",
      "costBasis": "pool",
      "isPrivate": true,
      "messageCount": 6,
      "events": [
        {
          "seq": 0,
          "ts": "2026-08-08T08:10:00.000Z",
          "model": "openai-web-unreported",
          "inputTokens": 120,
          "outputTokens": 340,
          "cacheReadTokens": 0,
          "cacheWrite5mTokens": 0,
          "cacheWrite1hTokens": 0,
          "iterations": 1,
          "toolCalls": []
        }
      ]
    }
  ]
}
```

## Idempotency model

- Browser session primary key: `web:<provider>:<providerConversationId>`.
- Web activity is currently represented by one aggregate usage event at `seq=0`.
- The extension does not POST when its local digest is unchanged.
- When content or project placement changes, the same session/event is submitted again.
- The ingest route updates every mutable usage-event field from Postgres `excluded.*` values.
- Tool calls are replaced wholesale for a replay.
- An identical system attribution is not appended repeatedly.

If the configured Aegis URL or ingest key changes, local dedupe state is cleared so open conversations
can be replayed safely to the new destination.

## Provider adapter assumptions

### ChatGPT

- Conversation ID comes from a `/c/<id>` path segment.
- A project is detected from a `g-p-...` path segment or `/project(s)/<id>` fallback.
- Conversation title prefers the exact current `/c/<id>` sidebar link, then the branded document title.
- Messages use `[data-message-author-role=user|assistant]`.

### Claude

- Conversation ID comes from `/chat/<id>` or `/chats/<id>`.
- Project ID comes from `/project/<id>` or `/projects/<id>`, with an active-link fallback.
- Conversation title prefers the semantic `chat-title-button`, then the exact current chat link and
  branded document title.
- Preferred semantic selectors are `data-testid`/`data-message-author-role`; the current implementation
  has conservative `font-user-message` and `font-claude-response` fallbacks.

DOM contracts are not public APIs. When extraction fails, send nothing rather than guessing from an
unrelated element. Add sanitized fixtures for every confirmed route/selector shape.

## Local setup

```bash
cp .env.example .env.local
pnpm install
pnpm db:push
pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts
pnpm dev
```

Load `extension/` through `chrome://extensions` → Developer mode → Load unpacked. Enter the Aegis URL
and generated key, review the disclosure, enable capture, then reload an open provider conversation.

## Validation completed

- `node --test extension/test/*.test.mjs`
- `node --check` for every top-level extension JavaScript file.
- JSON parsing for `extension/manifest.json` and `package.json`.
- `git diff --check`.
- Native Node type-stripping smoke test for `rollUpProjects` grouping, ordering, counts, and token sums.
- Unit coverage verifies payload labels, project metadata, token estimates, omission of an accidentally
  supplied plaintext message field, and unchanged-conversation dedupe.

## Validation not completed

- `pnpm install --frozen-lockfile` was rejected by the development environment's minimum package-age
  policy because 25 existing lockfile entries were too newly published. The policy was not bypassed.
- Consequently, no full TypeScript check or Next production build ran.
- ~~No database-backed end-to-end test ran.~~ `scripts/e2e-web-ingest.mts` now covers ingest → replay →
  tag → replay → render against a live server and database. Run it with `pnpm dev` up.
- No live logged-in Claude/ChatGPT smoke test ran.

## Known risks and deliberate cuts

1. `/me/chats` has no application authentication. It filters on a hardcoded owner (`u_arun`, the same
   stand-in `/me` uses), which is a placeholder for a login, not a security boundary. Keep the app
   local or externally protected until real user scoping lands.
2. The ingest route answers CORS preflight only for `chrome-extension://` origins. That is enough for
   the collector and keeps a leaked key from being replayed by any page a victim visits, but it is
   not an allowlist of *which* extension — any unpacked build with the key still ingests.
3. Character-count token estimation is directional, not billing-grade.
4. Only open/reloaded conversations are captured; there is no historical archive import.
5. DOM changes can silently move a conversation to `Unfiled chats` or prevent capture.
6. The collector stores a maximum of 500 local conversation dedupe entries.
7. The new session columns ship as a checked-in migration under `drizzle/`, but no rollback has been
   rehearsed against a database with existing rows.
8. Project is session metadata rather than a first-class table, so project history/rename reconciliation
   and explicit project-to-work-unit mapping do not exist yet.

## Recommended takeover sequence

1. Install an approved dependency set and run `pnpm build` plus the extension test.
2. Push the schema to a disposable database and verify bootstrap → POST → `/me/chats` end to end.
3. Capture sanitized DOM fixtures and live-smoke both provider adapters.
4. Add application authentication and filter `/me` and `/me/chats` by the authenticated user rather
   than the `DEMO_USER` constant.
5. Pin the accepted extension origin and add ingest rate limits.
6. Rehearse the migration against a populated database before sharing one.
7. Choose the next product increment from [`ROADMAP.md`](ROADMAP.md).
