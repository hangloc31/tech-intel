import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../../infra/src/db.js";
import { clusterBatch } from "../../../infra/src/cluster.js";
import { dedupMerge } from "../../../infra/src/merge.js";
import { upsertSource } from "../../../infra/src/store.js";
import { DEFAULT_WEIGHTS } from "../../../domain/src/rank.js";

const hasDb = !!process.env.DATABASE_URL;
const t = hasDb ? it : it.skip;
const SRC = `test-merge-${Date.now()}`;
const W = { ...DEFAULT_WEIGHTS };

async function seed(pool: ReturnType<typeof getPool>) {
  await upsertSource(pool, { id: SRC, cadence_ms: 60000 }, "rss");
  // m1/m2: same title, different url -> near_duplicate (merge).
  // m3: same entities, different title  -> related (link).
  // m4: independent.
  await pool.query(
    `INSERT INTO items (source_id, external_id, title, url, canonical_url, published_at, content_type, entities)
     VALUES ($1, 'm1', 'Acme ships Rust SDK', 'https://example.com/a', 'https://example.com/a', now(), 'article', ARRAY['Acme','Rust']),
            ($1, 'm2', 'Acme ships Rust SDK', 'https://example.com/b', 'https://example.com/b', now(), 'discussion', ARRAY['Acme','Rust']),
            ($1, 'm3', 'Acme releases Rust SDK', 'https://example.com/c', 'https://example.com/c', now(), 'article', ARRAY['Acme','Rust']),
            ($1, 'm4', 'Postgres 18 release notes', 'https://example.com/d', 'https://example.com/d', now(), 'article', ARRAY['Postgres'])`,
    [SRC],
  );
  await clusterBatch(pool, W, { sourceIds: [SRC] });
}

describe("merge integration", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    const ids = (await pool.query("SELECT id FROM stories WHERE original_source_id = $1", [SRC])).rows.map(
      (r) => r.id as number,
    );
    if (ids.length > 0) {
      await pool.query("DELETE FROM story_links WHERE story_a = ANY($1) OR story_b = ANY($1)", [ids]);
      await pool.query("DELETE FROM story_items WHERE story_id = ANY($1)", [ids]);
      await pool.query("DELETE FROM stories WHERE id = ANY($1)", [ids]);
    }
    await pool.query("DELETE FROM items WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM raw_contents WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM source_health WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM sources WHERE id = $1", [SRC]);
    await closePool();
  });

  t("merges near-dupes, links related, leaves independent alone", async () => {
    const pool = getPool();
    await seed(pool);
    const before = await pool.query("SELECT COUNT(*)::int c FROM stories WHERE original_source_id = $1", [SRC]);
    expect(before.rows[0].c).toBe(4);
    const stats = await dedupMerge(pool, W, { sourceIds: [SRC] });
    expect(stats.stories_merged).toBe(1);
    expect(stats.links_created).toBe(1);
    const after = await pool.query(
      "SELECT id, source_count FROM stories WHERE original_source_id = $1 ORDER BY source_count DESC",
      [SRC],
    );
    expect(after.rows).toHaveLength(3);
    expect(after.rows[0].source_count).toBe(2);
    // merged story holds m1+m2 with roles intact
    const members = await pool.query(
      `SELECT it.external_id, si.role FROM story_items si JOIN items it ON it.id = si.item_id
       WHERE si.story_id = $1 ORDER BY it.external_id`,
      [after.rows[0].id],
    );
    expect(members.rows).toEqual([
      { external_id: "m1", role: "original" },
      { external_id: "m2", role: "discussion" },
    ]);
    // related link between merged story and m3's story
    const m3story = await pool.query(
      `SELECT si.story_id FROM story_items si JOIN items it ON it.id = si.item_id
       WHERE it.source_id = $1 AND it.external_id = 'm3'`,
      [SRC],
    );
    const links = await pool.query(
      `SELECT * FROM story_links WHERE (story_a = $1 AND story_b = $2) OR (story_a = $2 AND story_b = $1)`,
      [after.rows[0].id, m3story.rows[0].story_id],
    );
    expect(links.rows).toHaveLength(1);
    // rerun is a no-op
    const rerun = await dedupMerge(pool, W, { sourceIds: [SRC] });
    expect(rerun.stories_merged).toBe(0);
    expect(rerun.links_created).toBe(0);
  }, 60000);
});
