/**
 * End-to-end check for the browser collector, against a running server and the
 * real database:
 *
 *   1. ingest a web conversation the way the extension does
 *   2. replay it grown — the seq=0 event must update, not duplicate
 *   3. tag it onto a work unit, the way /me/chats does
 *   4. replay again — the tag must survive
 *   5. render /me/chats, the issue page, / and /me and assert what shows where
 *
 * Step 4 is the one worth having. A replay used to write the freshly inferred
 * attribution over the stored row, so re-running a collector silently un-tagged
 * whatever an engineer had confirmed. Nothing catches that except ingesting
 * twice around a human decision.
 *
 * Creates and deletes its own machine and session; touches nothing else.
 *
 *   pnpm dev
 *   AEGIS_E2E_URL=http://localhost:3000 \
 *     pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/e2e-web-ingest.mts
 */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

const URL_BASE = process.env.AEGIS_E2E_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

const key = `aegis_mk_e2e_${randomUUID()}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const machineId = `m_e2e_${randomUUID().slice(0, 8)}`;
const convId = `e2e-${randomUUID().slice(0, 8)}`;
const sessionId = `web:anthropic:${convId}`;

await sql`insert into aegis.machines (id, name, user_id, key_hash)
          values (${machineId}, 'e2e browser', 'u_arun', ${keyHash})`;

const post = async (messageCount: number, inTok: number, outTok: number) => {
  const res = await fetch(`${URL_BASE}/api/ingest/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      machine: "e2e browser",
      sessions: [{
        sessionId,
        provider: "anthropic",
        surface: "claude_web",
        externalProjectId: "proj-e2e",
        externalProjectName: "E2E Project",
        externalConversationId: convId,
        externalConversationUrl: `https://claude.ai/chat/${convId}`,
        conversationTitle: "E2E conversation",
        captureMethod: "extension",
        usageBasis: "estimated",
        contentHash: "a".repeat(64),
        startedAt: "2026-08-08T08:00:00.000Z",
        endedAt: "2026-08-08T08:10:00.000Z",
        costBasis: "pool",
        isPrivate: true,
        messageCount,
        events: [{
          seq: 0, ts: "2026-08-08T08:10:00.000Z", model: "anthropic-web-unreported",
          inputTokens: inTok, outputTokens: outTok,
          cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0,
          iterations: 1, toolCalls: [],
        }],
      }],
    }),
  });
  return res.json();
};

const row = async () => (await sql`
  select message_count, work_unit_id, attribution_method, attribution_confidence,
         is_private, cost_basis, usage_basis, total_cost_usd,
         total_input_tokens, total_output_tokens
  from aegis.sessions where id = ${sessionId}`)[0];

const events = async () => (await sql`
  select count(*)::int as n, max(input_tokens)::int as input, max(output_tokens)::int as output
  from aegis.usage_events where session_id = ${sessionId}`)[0];

const audit = async () => (await sql`
  select count(*)::int as n from aegis.attributions where session_id = ${sessionId}`)[0];

let ok = true;
const check = (label: string, actual: unknown, expected: unknown) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${pass ? "" : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log("\n1. first ingest");
console.log("  ", await post(6, 120, 340));
let r = await row();
check("messageCount", r.message_count, 6);
check("cost is zero (model has no rate)", Number(r.total_cost_usd), 0);
check("cost_basis", r.cost_basis, "pool");
check("usage_basis", r.usage_basis, "estimated");
check("is_private", r.is_private, true);
check("attribution", `${r.attribution_method}/${r.attribution_confidence}`, "none/none");

console.log("\n2. replay, grown");
await post(10, 400, 900);
check("one event, not two", (await events()).n, 1);
check("input tokens overwritten", (await events()).input, 400);
check("output tokens overwritten", (await events()).output, 900);
check("messageCount updated", (await row()).message_count, 10);
check("audit trail did not grow", (await audit()).n, 1);

console.log("\n3. tag onto a work unit");
const [wu] = await sql`select id, identifier from aegis.work_units order by identifier limit 1`;
const tagRes = await fetch(`${URL_BASE}/api/attribute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "confirm", sessionId, workUnitId: wu.id }),
});
console.log("  ", await tagRes.json(), "->", wu.identifier);
r = await row();
check("tagged", `${r.attribution_method}/${r.attribution_confidence}`, "tagged/high");
check("published", r.is_private, false);
check("work unit set", r.work_unit_id, wu.id);

console.log("\n4. replay again — the tag must survive");
await post(14, 700, 1500);
r = await row();
check("still tagged", `${r.attribution_method}/${r.attribution_confidence}`, "tagged/high");
check("still on the work unit", r.work_unit_id, wu.id);
check("still published", r.is_private, false);
check("measurements still refreshed", r.message_count, 14);
check("no retraction in audit trail", (await audit()).n, 2);
check("still costs nothing", Number(r.total_cost_usd), 0);

console.log("\n5. rendered pages");
for (const path of ["/me/chats", `/issues/${wu.identifier}`, "/", "/me"]) {
  const html = await (await fetch(`${URL_BASE}${path}`)).text();
  const has = (s: string) => html.includes(s);
  console.log(`   ${path}`);
  if (path === "/me/chats") {
    check("  lists the conversation", has("E2E conversation"), true);
    check("  shows the tag", has(wu.identifier), true);
    // The whole point of the separate route: a pool figure must never render
    // with a dollar sign on it.
    check("  no dollar amount on the page", /\$\d/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), false);
  }
  if (path.startsWith("/issues")) {
    check("  Web chats block present", has("Web chats"), true);
    check("  conversation listed", has("E2E conversation"), true);
    check("  labelled est. tok", has("est. tok"), true);
    check("  basis says dollars + pool", has("dollars + pool"), true);
  }
  if (path === "/me") check("  web chat absent from the dollar view", has("E2E conversation"), false);
  if (path === "/") check("  board still renders", has("Aegis"), true);
}

console.log("\ncleanup");
await sql`delete from aegis.sessions where id = ${sessionId}`;
await sql`delete from aegis.machines where id = ${machineId}`;
await sql.end();
console.log(ok ? "\nALL CHECKS PASSED" : "\nFAILURES ABOVE");
process.exit(ok ? 0 : 1);
