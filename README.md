# Aegis

Aegis joins AI activity to the unit of work that caused it. This fork adds an opt-in browser collector
and a private project view for Claude and ChatGPT web conversations.

For a coding-agent takeover, start with [`AGENTS.md`](AGENTS.md), then read the detailed
[`browser tracking handoff`](docs/HANDOFF.md) and [`roadmap`](docs/ROADMAP.md).

## What the browser slice tracks

```text
provider -> project -> conversation -> usage snapshot
```

- Claude Projects and ChatGPT Projects retain their provider-native IDs and names.
- Conversations outside a project appear under **Unfiled chats**.
- Growing chats update the same Aegis session idempotently.
- The extension sends project/conversation metadata, counts, rough token estimates, and a SHA-256 digest.
- Prompt/response text, cookies, and login/session tokens never leave the browser.
- Web subscription usage is labelled `estimated / pool`; it is never mixed with billed API dollars.

This is a hackathon collector built against rendered site semantics. Claude and ChatGPT DOM changes may
require small selector updates in [`extension/content.js`](extension/content.js).

> **Hackathon boundary:** the current app has no user login. Run it locally or behind access control;
> do not expose the private `/me` view publicly until authentication and per-user filtering are added.

## Run locally

Requirements: Node.js 20+, pnpm, and a PostgreSQL/Neon database.

```bash
cp .env.example .env.local
pnpm install
pnpm db:push
pnpm machine:create -- --name "hackathon browser"
pnpm dev
```

Copy the one-time `aegis_mk_...` value printed by `machine:create`.

Then load the browser collector:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the repository's `extension/` directory.
3. Enter `http://localhost:3000` and the ingest key in the settings page.
4. Review the disclosure, enable automatic capture once, and save.
5. Open or reload a conversation on Claude or ChatGPT.
6. Visit `http://localhost:3000/me` to see project roll-ups.

The extension requests access only to the configured Aegis origin when you save. Site access for
`claude.ai` and `chatgpt.com` is declared in the extension manifest so capture can run automatically
after consent.

## Existing Claude Code collector

The original transcript collector remains available:

```bash
AEGIS_URL=http://localhost:3000 AEGIS_KEY=aegis_mk_... pnpm client --dry
AEGIS_URL=http://localhost:3000 AEGIS_KEY=aegis_mk_... pnpm client
```

It reads local Claude Code JSONL transcripts, while the extension covers rendered web conversations.
