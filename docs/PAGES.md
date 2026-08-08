# Pages and routes

Every route below is verified rendering, not just returning 200.

## Pages

### `/` — Cycle board

The sprint board with a cost badge on every issue. Four stat tiles (cycle cost,
issues, sessions, count over cohort P90), then one row per issue.

The bar in each row is **cost against that issue's cohort band**, not against the
global maximum of the column alone:

- Recessive grey fill spans **P50 → P90** for the issue's cohort.
- Thin grey tick marks **P50**; a brighter 2px tick marks **P90**. The P90 tick
  renders *above* the bar, because it is the threshold that decides "over" and
  has to stay readable when a long bar covers the band underneath it.
- The bar turns to the critical status colour only past P90, and always ships
  beside an `Nx median` label — colour never carries the meaning alone.

Attribution chips show method and confidence per issue. An issue with several
sessions attributed different ways shows several chips, because direct, derived
and tagged rows must never collapse into one unqualified number.

### `/issues/[identifier]` — Issue detail

`identifier` is the Linear key, e.g. `/issues/BAT-8`. Unknown keys 404.

Contains the issue's cost against its cohort band, a link out to Linear, the
**explainer**, the repeated-target list, and every session attributed to it with
its attribution mix printed above the table.

The explainer streams. Press *Explain* and prose arrives token by token; the
result is cached in `explanations` so re-opening during rehearsal is instant and
free. See [Explainer](#the-explainer) below.

### `/sessions/[id]` — Session detail

`id` is the Claude Code session UUID.

The important panel is **Where the money went**, which breaks cost into input,
cache read, cache write (5m), cache write (1h) and output. On a real session
this is where the thesis becomes visible: raw input is typically under a cent
while cache traffic is the entire bill.

Below it, repeated targets with their longest consecutive streak, then a
per-message timeline where bar length is that message's share of the most
expensive message in the session.

### `/me` — My sessions

The engineer's own surface, and the only place private sessions appear.

- **Needs attribution** — sessions with no work unit. *Suggest issue* asks Claude
  to propose a match from the files and commands the session touched; it returns
  a proposal plus one sentence of reasoning and **writes nothing**. Only
  *Confirm* attaches the session, as `tagged` / `high`. *Mark personal* sets
  `is_private` and detaches it.
- **Attributed** — what is currently on the team board.
- **Personal** — visible only here. Excluded from every aggregate by the
  queries themselves, not hidden in the UI.

The confirm step is both the UX and the privacy boundary. It is what makes this
a participant relationship rather than surveillance, and it is the only way
session-level data exists at all for surfaces with no API (see
[DECISIONS.md](./DECISIONS.md) ADR-0001).

### `/live` — Live ingest

Polls `/api/recent` every 3 seconds and lists the most recent sessions. Rows that
landed since the last poll flash green.

It polls rather than holding a stream deliberately: serverless instances do not
share memory, so a push channel would need a broker this does not need. The
database is authoritative; the in-process notice buffer only decorates rows with
recency, and a cold or different instance degrades to "no flash", never to wrong
data.

### `/settings/keys` — Machine keys

Registered machines, the last time each connected, and the collector install
snippet. Only the SHA-256 hash of a key is stored, so a key is unrecoverable
after it is issued — rotate by re-running `scripts/bootstrap.ts`.

---

## API routes

### `POST /api/ingest/sessions`

Auth: `Authorization: Bearer aegis_mk_…`, matched against `machines.key_hash`.

```jsonc
{
  "machine": "fedora",
  "sessions": [{
    "sessionId": "60c5769f-…",
    "cwd": "/home/arun/Dev/keytech-app",
    "gitBranch": "main",
    "ccVersion": "2.1.224",
    "startedAt": "…", "endedAt": "…",
    "events": [{
      "seq": 41,
      "requestId": "req_011Cdok…",
      "ts": "…",
      "model": "claude-sonnet-5",
      "inputTokens": 2,
      "outputTokens": 260,
      "cacheReadTokens": 13360,
      "cacheWrite5mTokens": 0,
      "cacheWrite1hTokens": 18161,
      "iterations": 1,
      "toolCalls": [{ "name": "Read", "target": "src/auth/session.ts" }]
    }]
  }]
}
```

**Idempotent on `(session_id, seq)`.** The client keeps no cursor and replays
whole transcripts on every run, so re-running it — including mid-demo — cannot
double-count. Tool calls have no natural key, so a session's set is replaced
wholesale rather than deduped row by row.

Attribution is resolved on ingest and the audit trail in `attributions` records
**changes only**; an ingest that resolves to the same answer writes nothing.

### `GET /api/explain/[identifier]`

Streams the explanation as `text/plain`. 404 on an unknown issue; a plain
sentence (not an error) when the issue has no sessions yet. Caches the result
into `explanations` on completion.

### `POST /api/attribute`

`{ action: "suggest" | "confirm" | "private", sessionId, workUnitId? }`

Ownership is checked against the session's `user_id` — 403 otherwise. `suggest`
is read-only.

### `GET /api/recent?since=<epoch_ms>`

Feeds `/live`. Returns totals plus the 20 most recent sessions, each flagged
`fresh` if it arrived after `since`.

---

## The explainer

`lib/signals.ts` computes every number — cost split, input share, cache hit
rate, repeated targets with streaks, retry count, peak-message share. Those
figures are rendered into a text digest by `lib/explain.ts`, and Claude writes
prose around them.

**The model never produces a statistic.** If a figure appears in the output, it
was computed server-side. This is why the explainer is fast enough to run live,
cheap enough to run per issue, and safe to put on a screen.

It also declines to invent a problem. On a healthy session it says so rather
than manufacturing a concern — the system prompt requires it, and it holds even
when the number on screen is large.

Model: `claude-opus-5` at `effort: medium`. Turning a computed digest into prose
is summarisation, not reasoning, and medium keeps it responsive on stage.

---

## Verified route status

| Route | Status |
|---|---|
| `/` | 200 |
| `/issues/BAT-8`, `/issues/BAT-12`, `/issues/BAT-16` | 200 |
| `/issues/BAT-99` | 404 — correct, unknown issue |
| `/sessions/[id]` | 200 |
| `/me` | 200, suggest→confirm exercised end to end |
| `/live` | 200 |
| `/settings/keys` | 200 |
| `/api/explain/*`, `/api/recent`, `/api/attribute`, `/api/ingest/sessions` | 200 |
