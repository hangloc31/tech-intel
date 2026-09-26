import { Pool } from "pg";

let pool: Pool | null = null;

/** Read-model pool for Route Handlers / Server Components. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 2 });
    pool.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "pg.pool_error", error: String(e) })));
  }
  return pool;
}
