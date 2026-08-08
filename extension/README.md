# Aegis Project Tracker extension

This unpacked Manifest V3 extension automatically captures project-level activity from open
`claude.ai` and `chatgpt.com` conversations after one-time consent.

It maps both products to the same Aegis hierarchy:

```text
provider -> project -> conversation -> usage snapshot
```

## Privacy boundary

The content script reads rendered messages to compute a message count, a rough character-based token
estimate, and a SHA-256 change digest. Message text is discarded in the page and is never included in
the network payload. The extension does not read or transmit cookies, local storage from either site,
or authentication/session tokens.

The ingest key is kept in extension-local storage restricted to trusted extension contexts; page
content scripts can only ask the service worker whether capture is enabled.

Metadata sent to your Aegis instance includes provider/project identifiers and names, conversation
identifier/title/URL, timestamps, counts, estimates, and the digest. Web subscription usage is always
stored as `usageBasis=estimated` and `costBasis=pool`; it is not authoritative API billing data.

## Load it for the hackathon

1. Start Aegis, run `pnpm db:push`, then print an ingest key with
   `pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts` (shown once).
2. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
3. Select this `extension/` directory.
4. In the settings page that opens, enter the Aegis URL and ingest key, review the disclosure, enable
   capture, and save.
5. Open or reload a Claude or ChatGPT conversation. Growing conversations resync automatically.

The collector uses stable semantic attributes when available and conservative fallbacks otherwise.
Provider DOM changes can require updates to `content.js`; a failed extraction sends no partial text.
