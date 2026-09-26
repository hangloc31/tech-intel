// Migration runner: applies packages/infra/db/migrations/*.sql in filename order.
// Tracks what ran in schema_migrations, so re-runs only apply new files.
// All existing migrations are written idempotently (IF NOT EXISTS), so the first
// tracked run safely replays them. Forward-only: no down migrations, by design.
//
// Usage: npm run db:migrate  (repo root) — needs DATABASE_URL (root .env is loaded).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

/** Pure: which files still need to run. Sorted, .sql only. Exported for tests. */
export function pendingMigrations(all: string[], applied: Set<string>): string[] {
  return all
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !applied.has(f))
    .sort();
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log("error", "migrate.no_database_url", { hint: "set DATABASE_URL in the repo-root .env" });
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await pool.query("SELECT filename FROM schema_migrations")).rows.map((r: { filename: string }) => r.filename),
    );
    const pending = pendingMigrations(readdirSync(MIGRATIONS_DIR), applied);
    if (pending.length === 0) {
      log("info", "migrate.up_to_date", { applied: applied.size });
      return;
    }
    log("info", "migrate.plan", { pending });
    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log("info", "migrate.applied", { file });
      } catch (e) {
        await client.query("ROLLBACK");
        log("error", "migrate.failed", { file, error: (e as Error).message });
        process.exitCode = 1;
        return;
      } finally {
        client.release();
      }
    }
    log("info", "migrate.done", { applied: pending.length });
  } finally {
    await pool.end();
  }
}

await main();
