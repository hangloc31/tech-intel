import { afterAll, describe, expect, it } from "vitest";
import { createProvider, promptHash } from "../../../infra/src/ai.js";
import { closePool, getPool } from "../../../infra/src/db.js";
import { enqueueEnrichJobs, processDueJobs } from "../../../infra/src/jobs.js";
import { upsertSource } from "../../../infra/src/store.js";
import type { EnrichmentProvider } from "../../../infra/src/ports.js";

const hasDb = !!process.env.DATABASE_URL;
const t = hasDb ? it : it.skip;
const SRC = `test-enrich-${Date.now()}`;
const MODEL = `stub-test-${Date.now()}`;

const stub: EnrichmentProvider = {
  name: MODEL,
  async summarize(title: string) {
    return { summary: `S:${title.slice(0, 10)}`, why_it_matters: "W", key_points: ["k1", "k2"] };
  },
};

const boom: EnrichmentProvider = {
  name: `${MODEL}-fail`,
  async summarize() {
    throw new Error("provider down");
  },
};

describe("enrich jobs", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    const ids = (await pool.query("SELECT id FROM items WHERE source_id = $1", [SRC])).rows.map((r) => r.id as number);
    if (ids.length > 0) {
      await pool.query("DELETE FROM enrichments WHERE item_id = ANY($1)", [ids]);
      await pool.query("DELETE FROM jobs WHERE (payload->>'item_id')::int = ANY($1)", [ids]);
      await pool.query("DELETE FROM jobs_failed WHERE (payload->>'item_id')::int = ANY($1)", [ids]);
    }
    await pool.query("DELETE FROM items WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM raw_contents WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM source_health WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM sources WHERE id = $1", [SRC]);
    await closePool();
  });

  t("enqueues, processes with provenance, and is idempotent", async () => {
    const pool = getPool();
    await upsertSource(pool, { id: SRC, cadence_ms: 60000 }, "rss");
    await pool.query(
      `INSERT INTO items (source_id, external_id, title, url, canonical_url, published_at, content_type)
       VALUES ($1, 'e1', 'Stub enrichment target', 'https://example.com/e1', 'https://example.com/e1', now(), 'article')`,
      [SRC],
    );
    expect(await enqueueEnrichJobs(pool, MODEL, 10, [SRC])).toBe(1);
    expect(await enqueueEnrichJobs(pool, MODEL, 10, [SRC])).toBe(0); // job already pending
    const stats = await processDueJobs(pool, stub, 10);
    expect(stats).toMatchObject({ processed: 1, failed: 0, dead: 0 });
    const rows = await pool.query("SELECT * FROM enrichments WHERE model_name = $1", [MODEL]);
    expect(rows.rows).toHaveLength(1);
    const e = rows.rows[0];
    expect(e.summary).toContain("S:Stub enri");
    expect(e.why_it_matters).toBe("W");
    expect(e.key_points).toEqual(["k1", "k2"]);
    expect(e.prompt_hash).toBe(promptHash());
    expect(e.model_version).toBe("v1");
    expect(e.source_item_id).toBe(`${SRC}:e1`); // provenance per AGENTS.md
    // Already enriched -> nothing new enqueued
    expect(await enqueueEnrichJobs(pool, MODEL, 10, [SRC])).toBe(0);
  }, 60000);

  t("moves exhausted jobs to jobs_failed", async () => {
    const pool = getPool();
    const item = await pool.query("SELECT id FROM items WHERE source_id = $1 AND external_id = 'e1'", [SRC]);
    const itemId = item.rows[0].id as number;
    await pool.query(
      "INSERT INTO jobs (kind, payload, max_attempts) VALUES ('enrich', jsonb_build_object('item_id', $1::int), 1)",
      [itemId],
    );
    const stats = await processDueJobs(pool, boom, 10);
    expect(stats.dead).toBe(1);
    const failed = await pool.query("SELECT last_error FROM jobs_failed WHERE (payload->>'item_id')::int = $1", [itemId]);
    expect(failed.rows.length).toBeGreaterThan(0);
    expect(failed.rows[0].last_error).toContain("provider down");
  }, 60000);

  it("createProvider returns null without configuration (AI disabled)", () => {
    const prev = { p: process.env.AI_PROVIDER, k: process.env.AI_API_KEY };
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    try {
      expect(createProvider()).toBeNull();
    } finally {
      if (prev.p !== undefined) process.env.AI_PROVIDER = prev.p;
      if (prev.k !== undefined) process.env.AI_API_KEY = prev.k;
    }
  });
});
