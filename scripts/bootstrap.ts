/**
 * Creates the demo user and a machine ingest key, then prints the key once.
 * Idempotent: re-running rotates the key for the same machine rather than
 * creating duplicates.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/bootstrap.ts
 */
import { randomBytes, createHash } from "node:crypto";
import { hostname } from "node:os";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, machines } from "../db/schema";

const USER_ID = "u_arun";
const USER_EMAIL = process.env.AEGIS_USER_EMAIL ?? "arunrk7.leo@gmail.com";
const USER_NAME = process.env.AEGIS_USER_NAME ?? "Arun";
const MACHINE_NAME = process.env.AEGIS_MACHINE ?? hostname();
const MACHINE_ID = `m_${MACHINE_NAME.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

async function main() {
  const db = getDb();

  await db
    .insert(users)
    .values({ id: USER_ID, email: USER_EMAIL, displayName: USER_NAME })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: USER_EMAIL, displayName: USER_NAME },
    });

  // Only the hash is stored, so the key is unrecoverable after this prints.
  const key = `aegis_mk_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");

  await db
    .insert(machines)
    .values({ id: MACHINE_ID, name: MACHINE_NAME, userId: USER_ID, keyHash })
    .onConflictDoUpdate({
      target: machines.id,
      set: { name: MACHINE_NAME, userId: USER_ID, keyHash },
    });

  console.log(`user     ${USER_ID}  ${USER_NAME} <${USER_EMAIL}>`);
  console.log(`machine  ${MACHINE_ID}  ${MACHINE_NAME}`);
  console.log(`\ningest key (shown once — add to .env.local as AEGIS_KEY):\n\n  ${key}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
