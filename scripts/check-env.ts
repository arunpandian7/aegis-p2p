/**
 * Verifies that DATABASE_URL and ANTHROPIC_API_KEY actually work, rather than
 * merely being present. Prints no secret values.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/check-env.ts
 */
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";

async function checkDb(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return fail("DATABASE_URL", "not set");
  if (url.includes("YOUR_DB_PASSWORD")) {
    return fail("DATABASE_URL", "still contains the YOUR_DB_PASSWORD placeholder");
  }

  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });
  try {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'aegis' order by table_name`;
    await sql.end();
    if (rows.length === 0) return fail("DATABASE_URL", "connected, but the aegis schema is empty");
    console.log(`OK  DATABASE_URL      ${rows.length} tables in aegis: ${rows.map((r) => r.table_name).join(", ")}`);
    return true;
  } catch (err) {
    await sql.end().catch(() => {});
    return fail("DATABASE_URL", (err as Error).message);
  }
}

async function checkAnthropic(): Promise<boolean> {
  try {
    const res = await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    const text = res.content.find((b) => b.type === "text");
    console.log(
      `OK  ANTHROPIC_API_KEY  model=${res.model} reply=${JSON.stringify(
        text && "text" in text ? text.text.trim() : "",
      )}`,
    );
    return true;
  } catch (err) {
    return fail("ANTHROPIC_API_KEY", (err as Error).message);
  }
}

function fail(name: string, reason: string): boolean {
  console.error(`FAIL ${name}  ${reason}`);
  return false;
}

async function main() {
  const results = await Promise.all([checkDb(), checkAnthropic()]);
  if (results.some((ok) => !ok)) process.exit(1);
  console.log("\nboth credentials work.");
}

main();
