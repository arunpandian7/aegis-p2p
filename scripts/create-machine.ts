import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getDb } from "../db";
import { machines } from "../db/schema";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const name = argument("--name") ?? process.env.AEGIS_MACHINE ?? `${hostname()} browser`;
  const key = `aegis_mk_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const id = `machine_${randomUUID()}`;

  await getDb().insert(machines).values({ id, name, keyHash });

  console.log(`Created ingest machine "${name}" (${id})`);
  console.log("Copy this key now; only its SHA-256 digest is stored:");
  console.log(key);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
