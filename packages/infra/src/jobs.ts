import type { Pool, PoolClient } from "pg";
import { promptHash } from "./ai.js";
import type { EnrichmentProvider } from "./ports.js";

export interface JobStats {
  processed: number;
  failed: number;
  dead: number;
}

/** Enqueue enrich jobs for recent items lacking an enrichment from this model. */
export async function enqueueEnrichJobs(
  pool: Pool,
  modelName: string,
  limit = 20,
  sourceIds?: string[],
): Promise<number> {
  const params: unknown[] = [modelName];
  let srcFilter = "";
  if (sourceIds) {
    params.push(sourceIds);
    srcFilter = `AND i.source_id = ANY($${params.length})`;
  }
  params.push(limit);
  const r = await pool.query(
    `INSERT INTO jobs (kind, payload, run_at)
     SELECT 'enrich', jsonb_build_object('item_id', i.id), now()
     FROM items i
     WHERE i.published_at > now() - interval '7 days' ${srcFilter}
       AND NOT EXISTS (SELECT 1 FROM enrichments e WHERE e.item_id = i.id AND e.model_name = $1)
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'enrich' AND (j.payload->>'item_id')::int = i.id)
     ORDER BY i.published_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rowCount ?? 0;
}

async function processOne(client: PoolClient, provider: EnrichmentProvider): Promise<"ok" | "fail" | "dead"> {
  const claimed = await client.query(
    `UPDATE jobs SET claimed_at = now(), attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE kind = 'enrich' AND claimed_at IS NULL AND run_at <= now()
                 ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, payload, attempts, max_attempts`,
  );
  if (claimed.rows.length === 0) return "ok"; // nothing due (not a failure)
  const job = claimed.rows[0] as { id: number; payload: { item_id: number }; attempts: number; max_attempts: number };
  const itemId = Number(job.payload?.item_id);
  try {
    const item = await client.query(
      `SELECT i.id, i.title, i.summary, i.source_id, i.external_id,
              (SELECT rc.id FROM raw_contents rc WHERE rc.source_id = i.source_id AND rc.external_id = i.external_id ORDER BY rc.id DESC LIMIT 1) AS raw_id
       FROM items i WHERE i.id = $1`,
      [itemId],
    );
    if (item.rows.length === 0) {
      await client.query("DELETE FROM jobs WHERE id = $1", [job.id]);
      return "ok";
    }
    const row = item.rows[0] as { id: number; title: string; summary: string | null; source_id: string; external_id: string; raw_id: number | null };
    const out = await provider.summarize(row.title, row.summary ?? undefined);
    if (out) {
      await client.query(
        `INSERT INTO enrichments (item_id, source_item_id, raw_id, model_name, model_version, prompt_hash, summary, why_it_matters, key_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.id, `${row.source_id}:${row.external_id}`, row.raw_id, provider.name, "v1", promptHash(), out.summary, out.why_it_matters, JSON.stringify(out.key_points)],
      );
    }
    await client.query("DELETE FROM jobs WHERE id = $1", [job.id]);
    return "ok";
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    if (job.attempts >= job.max_attempts) {
      // OVERRIDING SYSTEM VALUE: jobs_failed inherits the identity column via LIKE ... INCLUDING ALL.
      await client.query(
        `INSERT INTO jobs_failed (id, kind, payload, run_at, attempts, max_attempts, claimed_at, last_error, failed_at)
         OVERRIDING SYSTEM VALUE
         SELECT id, kind, payload, run_at, attempts, max_attempts, claimed_at, $2, now() FROM jobs WHERE id = $1`,
        [job.id, msg],
      );
      await client.query("DELETE FROM jobs WHERE id = $1", [job.id]);
      return "dead";
    }
    // Exponential backoff: 1m, 2m, 4m...
    await client.query(
      "UPDATE jobs SET claimed_at = NULL, run_at = now() + ($2 || ' minutes')::interval, last_error = $3 WHERE id = $1",
      [job.id, String(2 ** Math.min(job.attempts, 6)), msg],
    );
    return "fail";
  }
}

/** Claims and runs due enrich jobs (each in its own tx). Returns counts. */
export async function processDueJobs(pool: Pool, provider: EnrichmentProvider, limit = 10): Promise<JobStats> {
  const stats: JobStats = { processed: 0, failed: 0, dead: 0 };
  for (let i = 0; i < limit; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Peek: stop early when nothing is due (processOne returns ok without work).
      const due = await client.query(
        "SELECT COUNT(*)::int c FROM jobs WHERE kind = 'enrich' AND claimed_at IS NULL AND run_at <= now()",
      );
      if ((due.rows[0] as { c: number }).c === 0) {
        await client.query("ROLLBACK");
        break;
      }
      const r = await processOne(client, provider);
      await client.query("COMMIT");
      if (r === "ok") stats.processed++;
      else if (r === "fail") stats.failed++;
      else stats.dead++;
    } catch {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      stats.failed++;
    } finally {
      client.release();
    }
  }
  return stats;
}
