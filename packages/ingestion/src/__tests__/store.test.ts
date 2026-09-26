import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../../infra/src/db.js";
import { persistBatch, recordSourceHealth, upsertSource } from "../../../infra/src/store.js";
import type { NormalizedItem } from "../../../domain/src/types.js";

const hasDb = !!process.env.DATABASE_URL;
const t = hasDb ? it : it.skip;

const SRC = `test-store-${Date.now()}`;

function item(title: string, ext: string): NormalizedItem {
  return {
    source_id: SRC,
    external_id: ext,
    title,
    url: `https://example.com/${ext}`,
    canonical_url: `https://example.com/${ext}`,
    published_at: new Date().toISOString(),
    content_type: "article",
    topics: [],
    entities: [],
  };
}

describe("store integration", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    await pool.query("DELETE FROM items WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM raw_contents WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM source_health WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM sources WHERE id = $1", [SRC]);
    await closePool();
  });

  t("persists raw immutably and upserts items idempotently", async () => {
    const pool = getPool();
    await upsertSource(pool, { id: SRC, cadence_ms: 60000 }, "rss");
    const n = item("Hello world", "a1");
    const first = await persistBatch(pool, [{ raw: { a: 1 }, fetched_at: new Date().toISOString(), url: n.url, normalized: n }]);
    expect(first.raw_inserted).toBe(1);
    expect(first.items_upserted).toBe(1);
    // same content again -> no new raw, item upsert still counts
    const second = await persistBatch(pool, [{ raw: { a: 1 }, fetched_at: new Date().toISOString(), url: n.url, normalized: n }]);
    expect(second.raw_inserted).toBe(0);
    // changed content -> new raw row (immutable history)
    const third = await persistBatch(pool, [{ raw: { a: 2 }, fetched_at: new Date().toISOString(), url: n.url, normalized: n }]);
    expect(third.raw_inserted).toBe(1);
    const raws = await pool.query("SELECT COUNT(*)::int AS c FROM raw_contents WHERE source_id = $1", [SRC]);
    expect(raws.rows[0].c).toBe(2);
  });

  t("records health with EMA error_rate", async () => {
    const pool = getPool();
    await recordSourceHealth(pool, SRC, { latency_ms: 100, fetched_count: 5, failed: false });
    await recordSourceHealth(pool, SRC, { latency_ms: 200, fetched_count: 0, failed: true, error: "boom" });
    const r = await pool.query("SELECT error_rate, fetched_count FROM source_health WHERE source_id = $1", [SRC]);
    expect(r.rows[0].fetched_count).toBe(0);
    expect(r.rows[0].error_rate).toBeGreaterThan(0);
    expect(r.rows[0].error_rate).toBeLessThan(1);
  });
});
