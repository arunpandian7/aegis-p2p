# Aegis — Unit Economics for Agentic Engineering

**Event:** Push to Prod: Building at the Frontier — Anthropic × Elevation Capital
**Part of:** Basecamp, Bengaluru (Aug 6–12, 2026)
**Date:** August 8, 2026 · 5 hours build · in-person
**Owner:** Arun
**Status:** Scope revised after competitive scan. Pitch angle locked. Build scope needs one more cut.

---

## 1. The one-liner

> Software teams have measured engineering in **hours** for fifty years. Agentic teams burn **tokens**. Aegis attributes every AI session — Claude Code and Claude.ai chat — to the unit of work that caused it, so teams can see which features actually cost what.

**Not:** a spend dashboard. **Not:** a Linear plugin.
**Is:** the `session → work_unit` join. The primitive nobody owns.

---

## 2. Background

### Original Aegis thesis
Analytics layer for AI-native apps: ingest agent traces, tool calls, feedback; explore in plain English via Claude. Too broad to build in five hours, too broad to defend.

### Where it landed
Track **all AI sessions across surfaces** — Claude Code and Claude.ai to start — unify them in one UI, attribute each to a Linear issue. Teams see cost per feature. Engineers get a private personal view for their own untagged sessions.

### Why now
- Agentic workflows: 5–30× more tokens per task than chat (Gartner, Mar 2026); multi-agent compounds 3–10× beyond projections.
- 98% of FinOps practitioners now manage AI spend, up from 31% two years ago (State of FinOps 2026). Top forward-looking priority.
- Linux Foundation launched the **Tokenomics Foundation** (9 Jun 2026, FinOps X) with the FinOps Foundation to standardise token measurement.
- Attribution granularity has marched down: cloud bill → token → agent run/session. **Next step is the unit of work. Unclaimed.**
- On subscription plans, chat / Claude Code / Cowork **draw from the same usage pool** — burn it in the terminal by lunch and you've burned it in chat too. Engineers currently have no way to see this coming.

---

## 3. Market scan

### Commoditised — consume, don't compete
LiteLLM, Bifrost, Portkey, OpenRouter. Gateway-level spend per key/user/team, free and open source.

### Observability (cost inside the trace)
Langfuse, Braintrust, Datadog LLM Observability, LangSmith, Galileo. Braintrust's own line: a dedicated cost tool is unnecessary if your observability platform already logs tokens against traces.

### FinOps / chargeback — sells to finance, never touches the tracker
Mavvrik (Agentic Cost Intelligence SDK, OTel-native), Amnic, CloudZero, Vantage, Lenxes.

### Engineering intelligence — the real competitors
| Player | Granularity | Gap |
|---|---|---|
| **LinearB** | Tokens from Claude API, Claude OTel, Cursor → correlated to users, teams, repos, PRs. **Daily per-user records.** | No issue-level. No forecasting. |
| **Faros.ai** | Team, repo, tool, model, type of work | Aggregate only |
| **Jellyfish** | Claude Code vs Copilot vs Cursor tied to delivery metrics | Adoption lens |
| **Torii / StackSpend** | Seat + token spend per employee, idle seats, overlap detection | SaaS governance |

### ⚠️ Anthropic is the closest competitor, not LinearB
The **Enterprise Analytics API** already returns named users with emails, individual token usage, USD spend, and engagement patterns — conversations, Claude Code sessions, commits, PRs, lines of code, Cowork actions, skills, connectors. July 2026 added per-user cost visibility with model breakdowns and spend-limit progress, plus analytics chat answering plain-language questions with exportable charts.

**Read that as: the personal spend dashboard is already shipped by the vendor. Do not pitch it as a feature.**

Two gaps we live in:
1. **No per-request granularity.** Usage/cost endpoints aggregate to time buckets and user-level rollups. Anthropic gives `user × day × product`. Nobody gives `session × issue`.
2. **No link to the work.** Anthropic knows a session happened. It does not know it was ENG-142, or that ENG-142 was a payments bug that shipped.

### Verdict
The wedge is narrower than originally framed but still real: **session-to-work-unit attribution, and everything that unlocks downstream.**

---

## 4. The product

### Core primitive
```
(work_unit_id, session_id, surface, provider, model,
 input_tokens, output_tokens, cached_tokens, cost,
 attribution_method, attribution_confidence)
```

`attribution_method` and `attribution_confidence` are first-class columns. Direct, derived, engineer-tagged, and allocated rows must never be summed into one number without showing the mix. This is the difference between a demo and something finance will accept.

### Ingestion — honest per-surface reality
| Surface | What's actually available | Attribution | Confidence |
|---|---|---|---|
| **Claude Code** | OTel export: session ID, model, tokens, tool calls. Inject issue key via `OTEL_RESOURCE_ATTRIBUTES`, or derive `cwd` → git branch (`arun/ENG-142-fix-auth`) | Direct | High |
| **Claude.ai chat** | **No session-level API.** Enterprise Analytics API only, user×day rollups. Pro/Team plans unsupported entirely | **Engineer-tagged** (see below) | Medium |
| **Direct API calls** | Own gateway, metadata tags | Direct | High |
| **PR-linked sessions** | PR → Linear issue via Linear's GitHub integration | Derived | Medium |
| **Cursor** | Admin API daily per-user aggregate. No per-task data exists | Allocated by commit activity | Low |

**Known dead ends:** Bedrock-routed Claude Code doesn't appear in the Analytics API. Claude.ai Pro/Team have no analytics API at all. Seat-plan "cost" is pool consumption, not marginal dollars — label it as such.

### The personal dashboard — reframed
❌ **Not:** "track engineers' personal chat spend so they don't overrun."
That is surveillance, it duplicates Anthropic's admin console, and it gets the tool banned by the first skeptical EM. Teams that believe they're being watched use AI tools less.

✅ **Is:** the engineer's own private surface where they **attribute their own sessions**. Claude proposes a mapping (this conversation looks like ENG-142); the engineer confirms, corrects, or marks it personal. Personal stays private and never rolls up.

This reframe does three jobs at once:
- Produces the session-level chat data no API will give you
- Makes the engineer a participant, not a subject
- Turns the privacy liability into the data-collection UX

Engineer-facing value is **pool burn-rate awareness** — "you're 70% through the shared pool on day 11" — not a spending scorecard.

### Where Claude is the intelligence layer
1. **Attribution suggestion.** Reads a session (with consent) and proposes the work unit. The confirm step is both UX and privacy boundary.
2. **The explainer.** "Why did ENG-142 cost $47 when its cohort averages $3?" Claude reads the trace — tool loops, re-reads, context thrash, retries — and answers in prose. **This is the demo. Dashboards structurally cannot do it.**
3. **Work classification.** Labels issues into semantic cost cohorts (schema migration / UI tweak / flaky test hunt) from title, description, diff.
4. **Routing policy.** "Bugs in `payments-svc`: $11 on Opus, $9.80 on Sonnet, equal close rate — route this class to Sonnet."

### Forecasting — deliberately contrarian
Microsoft Research: unconstrained coding agents cost $5–8 per SWE task and **the same agent on the same task varies up to 30×**, driven mostly by retrieved context quality. Databricks: cheaper per-token ≠ cheaper per-task.

- **Per-issue → a band, never a point.** Quantile regression (P50/P90) over cohort, estimate points, repo, historical neighbours.
- **Per-sprint → genuinely forecastable.** 30× on one issue; the sum of 40 concentrates. That's the number an EM needs.

Saying "point estimates are dishonest, here's a distribution" is a credibility move, not a hedge.

---

## 5. Hackathon theme fit

| Criterion | Angle |
|---|---|
| **Frontier capability** | Cross-surface session → work-unit resolution with explicit confidence modelling. Anthropic stops at user×day; LinearB stops at daily-per-user. |
| **Billion-dollar path** | Gartner: agentic AI spend $201.9B in 2026, +141% YoY; 40% of business apps embed task-specific agents by year end. Every org adopting agents hits this. |
| **Redefines a category** | Engineering measurement moves from time to cost-per-outcome. Worklogs and story points become legacy instruments. |
| **New interface** | The unit of work becomes queryable. You ask an *issue* why it was expensive; it answers. |
| **Infrastructure** | The `work_unit → token cost` join is a primitive every EM tool, IDE, and FinOps platform will need. Ship the schema open, aligned to Tokenomics Foundation direction. |

**Pitch discipline:**
- Lead with the primitive and the measurement-era shift. Linear is the first surface, mentioned second.
- Do **not** lead with natural-language querying — Anthropic's analytics chat shipped in July.
- Do **not** lead with the personal dashboard — the admin console shipped per-user cost in July.
- Lead with: cost per *issue*, and the explainer.

---

## 6. Five-hour build plan

**Rule: demo quality > pipeline completeness.** Seed replayed/synthetic sessions; do not fight live OTel plumbing or Enterprise API gating.

| Time | Deliverable |
|---|---|
| 0:00–0:30 | Freeze scope. Seed Linear workspace (~40 closed issues) + synthetic Claude Code OTel traces + a handful of chat sessions, incl. 2–3 deliberate blowups |
| 0:30–1:30 | Ingestion + attribution: traces → branch/PR → `work_unit_id`, confidence tiering. DuckDB or Postgres. Not a lakehouse. |
| 1:30–2:45 | **Claude layer: cohort classification + the "why was this expensive" explainer.** Most time here. |
| 2:45–3:30 | Unified UI: issue cost badge, cross-surface breakdown (Code vs chat), one runaway alert |
| 3:30–4:15 | Personal view: engineer's untagged sessions + Claude-suggested attribution + confirm action |
| 4:15–5:00 | Rehearsal, deck, buffer |

### Cut list (in order)
1. Live Linear API → hardcoded seeded workspace
2. Sprint forecast → per-issue bands only
3. Routing recommendations → roadmap slide
4. Personal view → static mockup screen
5. **Never cut:** the explainer

### Demo script (90s)
1. Sprint board — every issue carries a cost badge, split Claude Code vs chat. *Nobody has seen this.*
2. One issue red: $47 against a $4 cohort P50.
3. Click → Claude explains: agent re-read the same three files eleven times, ticket had no repro steps, 89% of spend was input tokens.
4. Engineer view: three untagged sessions, Claude suggests ENG-142, one click confirms. **"This is how the data gets there — the engineer opts in, we never scrape."**
5. Close: "Time tracking measured the last era of software. This measures the next one."

---

## 7. Open items

> Several items below are now resolved — see [DECISIONS.md](./DECISIONS.md) ADR-0001
> (surface scope, cached-token handling, `cwd`→branch→issue resolution).

### 🔴 Resolve before pitching
- [ ] **Anthropic overlap.** Their console ships per-user cost, spend limits, analytics chat. Have a one-sentence answer ready: *"They measure the person and the day. We measure the work."* Expect this question from Anthropic mentors specifically.
- [ ] Seed data must feel real. Invented-looking traces kill the pitch.
- [ ] Product name — "Aegis" reads security, not economics. Candidates: Ledger, Meter, Tally
- [ ] Deck: 5 slides. Problem → primitive → demo → market → why now.

### Technical unknowns
- [ ] Does Claude Code OTel carry enough to resolve `cwd` → branch → issue, or is a session-start hook required?
- [ ] Claude.ai chat ingestion for non-Enterprise: browser extension? Manual export? Copy-paste session ID? **No API path exists — pick the least-bad UX.**
- [ ] Cached-token handling: cache hit share runs 89–95% on well-structured routes. Ignoring cache pricing makes every number wrong.
- [ ] Seat-plan cost is notional (pool share), Enterprise/API cost is real dollars. Never mix them in one total.
- [ ] Cursor allocation weighting — commits touched during in-progress window?
- [ ] Estimate vs invoice reconciliation: stale registry prices, batch discounts, fine-tuned models billed at base rates.

### Strategic / post-hackathon
- [ ] **Surveillance stance.** Cost per *issue*, never cost per *developer*. Personal sessions never roll up. Write this into the product, not just the pitch — investors will probe it.
- [ ] Defensibility vs LinearB: they will close the granularity gap. Moat is the cross-org forecasting model + owning the schema.
- [ ] ICP conflict: Enterprise plans have the API but slow sales; small teams are reachable but have no chat data source. Which do we build for?
- [ ] Jira / GitHub Projects next, or go deep on Linear?
- [ ] Pricing: per-seat or % of tracked spend? (% of spend means profiting from waste — bad incentive.)
- [ ] Open-source the attribution schema as a Tokenomics-aligned standard? Land grab vs giving away the wedge.

### Ask the mentors
- **Anthropic:** is per-session issue-key injection into Claude Code OTel a supported pattern? Any roadmap for session-level granularity in the Analytics API — i.e. are we building on sand?
- **Elevation:** does this read as infrastructure, or as a feature LinearB ships in two quarters? Sharpen the answer before the room asks it.
