# Decision Records

Append-only. Each record states what we decided, what forced it, and what it costs us.

---

## ADR-0001 — Dollar accounting is API-side only; claude.ai chat is pool consumption

**Date:** 2026-08-08
**Status:** Accepted
**Supersedes:** the "Claude.ai chat ingestion for non-Enterprise" open item in [Idea.md](./Idea.md) §7

### Context

Aegis's core primitive is `(work_unit_id, session_id, … cost)`. That requires a
per-session cost for every surface we claim to cover. We had assumed two
first-class surfaces: Claude Code and claude.ai chat.

Claude Code turned out to be easy — easier than planned. Every row of a local
transcript (`~/.claude/projects/<slug>/<uuid>.jsonl`) carries `sessionId`,
`cwd`, `gitBranch`, `timestamp`, `model` and a full `usage` object. No OTel
pipeline, no `OTEL_RESOURCE_ATTRIBUTES` injection, and no session-start hook is
needed to reach Direct/High attribution.

claude.ai chat did not.

### Finding: there is no session-level cost data for claude.ai chat

| Path | What it yields | Why it fails |
|---|---|---|
| Enterprise Analytics API | `user × day × product` rollups, USD spend | No per-session granularity — this *is* the gap we are pitching into. Enterprise plans only. |
| Pro / Team / Max plans | nothing | No analytics API exists at any tier below Enterprise. |
| Account data export | conversation content + timestamps | Manual, asynchronous, and carries **no token counts and no cost**. *(Contents not verified first-hand — treat as indicative.)* |
| Browser extension | live session data | Fragile against UI changes, and directly contradicts the "the engineer opts in, we never scrape" position the product depends on. |

There is no counterpart to the on-disk transcript. Nothing to parse.

### The finding that actually decided it

We could, in principle, re-tokenise exported conversation text with
`messages.count_tokens` and synthesise an input-token estimate. We are not
going to, because such a number would be wrong by roughly an order of
magnitude and wrong in a way that is invisible.

Measured across the 7 real Claude Code sessions on the author's machine
(2026-08-08, Claude Code 2.1.224, $51.79 total):

- Input-side spend was **59–100%** of session cost; the largest session was
  **94.7%**.
- Of that, raw `input_tokens` were **negligible** — one representative message
  carried 2 input tokens against 13,360 cache-read and 18,161 cache-creation.
- Cache creation splits by TTL (`ephemeral_1h` vs `ephemeral_5m`) and the two
  bill at **2.0×** and **1.25×** the input rate respectively.

So the entire cost signal lives in the cache read/write split, and an export
gives us no way to recover it. A "cost" reconstructed from conversation text
would not be a measurement with error bars. It would be a guess with a dollar
sign in front of it, and it would silently corrupt every issue total it touched.

### Decision

1. **Dollar-denominated accounting covers Anthropic API consumption only** —
   Claude Code sessions and direct API calls, where real token counts and real
   rates exist. These are `cost_basis = 'dollars'`.

2. **claude.ai chat is tracked as pool consumption, not cost.** On a seat plan
   it is not marginal spend; burning the shared pool in the terminal by lunch
   burns it in chat too. These are `cost_basis = 'pool'`, and **pool rows are
   never summed into a dollar total.**

3. **Chat is engineer-tagged, never fetched.** Where a chat session enters the
   system at all, it does so because the engineer attributed it on their own
   private view — `attribution_method = 'tagged'`, which outranks every inferred
   method in the ladder because a human confirmation genuinely is better
   evidence than a branch regex.

### Consequences

**In the schema, already:**

- `sessions.cost_basis` (`'dollars'` | `'pool'`) — enforced as a column, not a
  convention, so the two can never be accidentally added together.
- `sessions.attribution_method` + `attribution_confidence` travel with every
  row; `lib/attribution.ts` exposes `confidenceMix()` so no total can be
  rendered without its composition.
- `usage_events` splits `cache_write_5m_tokens` from `cache_write_1h_tokens`.
  A single `cached_tokens` column would have made every number wrong.

**We lose:** the clean "cross-surface" claim. We cannot say we measure chat the
way we measure Claude Code, because nobody can.

**We gain:** the reason the personal view exists. The missing API is what makes
engineer-tagging necessary, and engineer-tagging is what makes the product a
participant relationship rather than surveillance. The constraint produces the
UX rather than damaging it.

**For the pitch:** this sharpens the Anthropic-overlap answer rather than
weakening it. Anthropic ships `user × day × product`. We ship `session → work
unit`, and we are explicit that where per-session truth does not exist, we
label it pool consumption instead of inventing a number. That distinction is
the thing finance will actually test.

### Not doing (and why)

- **Browser extension for chat capture** — contradicts the privacy stance,
  which is load-bearing for the pitch, not decoration.
- **Estimating chat cost from exported text** — see above; the cache split is
  unrecoverable, so the estimate would be confidently wrong.
- **Cursor / other tools** — Admin APIs give daily per-user aggregates only.
  Same class of problem; if ingested at all they are `'pool'` and `'allocated'`
  at low confidence.

### Follow-on, if time allows

A paste-in on `/me`: the engineer pastes a conversation, we count tokens for a
rough input figure, store it `cost_basis: 'pool'` / `attribution_method:
'tagged'`, and render it as a **separate bar that never merges into the dollar
total**. Roughly 30 minutes. It makes the cross-surface claim concrete without
compromising rule 2. Below the explainer and the board in priority — see the
cut list in [Idea.md](./Idea.md) §6.

### Open items this closes

- §7 *"Claude.ai chat ingestion for non-Enterprise: browser extension? Manual
  export? Copy-paste session ID?"* → resolved: engineer-tagged paste-in, pool
  basis, no scraping.
- §7 *"Does Claude Code OTel carry enough to resolve cwd → branch → issue, or is
  a session-start hook required?"* → resolved: neither. The local transcript
  carries `cwd` and `gitBranch` on every row.
- §7 *"Cached-token handling"* → resolved: three-way split (read / 5m write /
  1h write), priced by TTL, verified against real sessions.
- §7 *"Seat-plan cost is notional … never mix them in one total"* → enforced by
  `cost_basis`.

### Still open

- **Estimate vs invoice reconciliation.** Rates carry effective dates
  (`lib/pricing.ts`) because Sonnet 5 is on introductory pricing until
  **2026-08-31**; sessions are priced against their own timestamp, not `now()`.
  Batch discounts and negotiated rates remain unmodelled.
- **Ask Anthropic mentors:** is the on-disk transcript format something we can
  build on, or should we expect it to move? That is now the single dependency
  under the Claude Code ingestion path.
