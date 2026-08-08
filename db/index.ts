import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Supabase Postgres. Tables live in the `aegis` schema (see schema.ts), which
 * Drizzle qualifies explicitly on every query — so no search_path juggling.
 *
 * Use the *pooler* connection string (port 6543, `pooler.supabase.com`).
 * Serverless functions open a connection per invocation and the direct 5432
 * endpoint runs out of slots under any real traffic.
 */

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, {
    // Transaction-mode poolers cannot cache prepared statements.
    prepare: false,
    max: 3,
    idle_timeout: 20,
  });

  return drizzle(client, { schema });
}

// Plain lazy `let`, not a Proxy: a Proxy breaks libraries that introspect the
// client, and lazy init keeps `next build` from crashing before env is set.
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}
