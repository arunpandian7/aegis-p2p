# Agent guide

The instructions for this repository live in **[CLAUDE.md](CLAUDE.md)** — stack,
commands, where the data comes from, and the invariants that must not be broken.
Read it first; this file exists only so tools that look for `AGENTS.md` find it.

Two documents carry the reasoning that the code cannot:

- [docs/DECISIONS.md](docs/DECISIONS.md) — why chat usage is pool consumption and
  never dollars (ADR-0001), and the terms the browser collector had to meet to be
  admitted anyway (ADR-0002).
- [docs/PAGES.md](docs/PAGES.md) — every route and the ingest contract.

For the browser collector specifically: [docs/HANDOFF.md](docs/HANDOFF.md) is the
architecture and data inventory, [docs/ROADMAP.md](docs/ROADMAP.md) the follow-up
work, and [extension/README.md](extension/README.md) the install steps.
