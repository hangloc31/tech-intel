import { Pool } from "pg";

let pool: Pool | null = null;

/** Singleton pool. Reads DATABASE_URL; keeps max small for Neon free tier. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 3 });
    pool.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "pg.pool_error", error: String(e) })));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
