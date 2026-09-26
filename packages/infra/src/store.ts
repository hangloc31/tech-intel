import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { NormalizedItem } from "../../domain/src/types.js";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Minimal source identity — structural only, so infra never imports ingestion. */
export interface SourceRef {
  id: string;
  cadence_ms: number;
}

export interface PersistableItem {
  raw: unknown;
  fetched_at: string;
  url: string;
  normalized: NormalizedItem;
}

/** Registers/updates the source row. No-op conflict path keeps existing trust/cadence. */
export async function upsertSource(pool: Pool, meta: SourceRef, type: string): Promise<void> {
  await pool.query(
    `INSERT INTO sources (id, type, enabled, cadence_ms)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, cadence_ms = EXCLUDED.cadence_ms`,
    [meta.id, type, meta.cadence_ms],
  );
}

/**
 * Persists a batch: raw_contents rows are immutable (conflict on
 * source+external+checksum = new content only), items are upserted on
 * source+external. Returns counts of inserted/upserted rows.
 *
 * Two round-trips per chunk regardless of batch size (previously 2N queries for
 * N items — ~5k round-trips to Neon on a full run). Chunks of 500 bound the
 * parameter size; the whole batch still commits or rolls back atomically.
 */
export async function persistBatch(
  pool: Pool,
  items: PersistableItem[],
): Promise<{ raw_inserted: number; items_upserted: number }> {
  let raw_inserted = 0;
  let items_upserted = 0;
  if (items.length === 0) return { raw_inserted, items_upserted };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const rawRes = await client.query(
        `INSERT INTO raw_contents (source_id, external_id, url, fetched_at, payload, checksum)
         SELECT v.source_id, v.external_id, v.url, v.fetched_at, v.payload::jsonb, v.checksum
         FROM jsonb_to_recordset($1::jsonb)
           AS v(source_id text, external_id text, url text, fetched_at timestamptz, payload text, checksum char(64))
         ON CONFLICT (source_id, external_id, checksum) DO NOTHING`,
        [
          JSON.stringify(
            chunk.map((it) => {
              const n = it.normalized;
              return {
                source_id: n.source_id,
                external_id: n.external_id,
                url: it.url,
                fetched_at: it.fetched_at,
                payload: toJsonbText(it.raw),
                checksum: sha256Hex(typeof it.raw === "string" ? it.raw : JSON.stringify(it.raw)),
              };
            }),
          ),
        ],
      );
      raw_inserted += rawRes.rowCount ?? 0;
      const itemRes = await client.query(
        `INSERT INTO items (source_id, external_id, title, url, canonical_url, author,
                            published_at, summary, image_url, content_type, topics, entities, updated_at)
         SELECT v.source_id, v.external_id, v.title, v.url, v.canonical_url, v.author,
                v.published_at, v.summary, v.image_url, v.content_type, v.topics, v.entities, now()
         FROM jsonb_to_recordset($1::jsonb)
           AS v(source_id text, external_id text, title text, url text, canonical_url text, author text,
                published_at timestamptz, summary text, image_url text, content_type text,
                topics text[], entities text[])
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           title = EXCLUDED.title, url = EXCLUDED.url, canonical_url = EXCLUDED.canonical_url,
           author = EXCLUDED.author, published_at = EXCLUDED.published_at, summary = EXCLUDED.summary,
           image_url = COALESCE(EXCLUDED.image_url, items.image_url),
           content_type = EXCLUDED.content_type, topics = EXCLUDED.topics, entities = EXCLUDED.entities,
           updated_at = now()`,
        [
          JSON.stringify(
            chunk.map((it) => {
              const n = it.normalized;
              return {
                source_id: n.source_id,
                external_id: n.external_id,
                title: n.title,
                url: n.url,
                canonical_url: n.canonical_url,
                author: n.author ?? null,
                published_at: n.published_at,
                summary: n.summary ?? null,
                image_url: n.image_url ?? null,
                content_type: n.content_type,
                topics: n.topics,
                entities: n.entities,
              };
            }),
          ),
        ],
      );
      items_upserted += itemRes.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { raw_inserted, items_upserted };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Serializes a raw payload for the jsonb column (max 200KB, same budget as before).
 * Truncation can split a JSON document mid-way, so an invalid result falls back to
 * a plain JSON string instead of failing the whole batch on `::jsonb`.
 */
export function toJsonbText(raw: unknown): string {
  const s = (typeof raw === "string" ? JSON.stringify(raw) : JSON.stringify(raw))?.slice(0, 200000) ?? "null";
  try {
    JSON.parse(s);
    return s;
  } catch {
    return JSON.stringify(s.slice(0, 100000));
  }
}

export interface HealthSample {
  latency_ms: number;
  fetched_count: number;
  failed: boolean;
  error?: string;
}

/** Records per-run health; error_rate is an EMA so one blip doesn't pin it at 1. */
export async function recordSourceHealth(pool: Pool, source_id: string, s: HealthSample): Promise<void> {
  await pool.query(
    `INSERT INTO source_health (source_id, last_run_at, latency_ms, error_rate, fetched_count)
     VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (source_id) DO UPDATE SET
       last_run_at = now(), latency_ms = EXCLUDED.latency_ms, fetched_count = EXCLUDED.fetched_count,
       error_rate = (source_health.error_rate * 0.9 + EXCLUDED.error_rate * 0.1)`,
    [source_id, s.latency_ms, s.failed ? 1 : 0, s.fetched_count],
  );
  await pool.query(`UPDATE sources SET last_run_at = now(), last_error = $2 WHERE id = $1`, [
    source_id,
    s.failed ? (s.error ?? "unknown").slice(0, 500) : null,
  ]);
}
