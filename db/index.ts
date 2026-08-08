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

  if (url.includes(".pooler.supabase.com:5432")) {
    // Session mode dedicates a Postgres connection to each client for its whole
    // life, so serverless invocations exhaust the pool (EMAXCONNSESSION at 15)
    // rather than queueing. Fail loudly here instead of at random under load.
    throw new Error(
      "DATABASE_URL points at the session-mode pooler (:5432). Use the transaction pooler (:6543).",
    );
  }

  const client = postgres(url, {
    // Transaction-mode poolers cannot cache prepared statements.
    prepare: false,
    // One connection per instance. Invocations are short and the pooler
    // multiplexes; a larger pool just holds slots other instances need.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
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
