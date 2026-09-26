import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../../infra/src/db.js";
import { clusterBatch } from "../../../infra/src/cluster.js";
import { upsertSource } from "../../../infra/src/store.js";
import { DEFAULT_WEIGHTS } from "../../../domain/src/rank.js";

const hasDb = !!process.env.DATABASE_URL;
const t = hasDb ? it : it.skip;
const SRC = `test-cluster-${Date.now()}`;

async function seed(pool: ReturnType<typeof getPool>) {
  await upsertSource(pool, { id: SRC, cadence_ms: 60000 }, "rss");
  // Two dupes (same title + canonical url) + one independent.
  await pool.query(
    `INSERT INTO items (source_id, external_id, title, url, canonical_url, published_at, content_type)
     VALUES ($1, 'c1', 'Same Big Launch', 'https://example.com/x?a=1', 'https://example.com/x', now(), 'article'),
            ($1, 'c2', 'Same Big Launch', 'https://example.com/x?b=2', 'https://example.com/x', now(), 'discussion'),
            ($1, 'c3', 'Totally Different Thing', 'https://example.com/y', 'https://example.com/y', now(), 'article')`,
    [SRC],
  );
}

describe("cluster integration", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    await pool.query(
      `DELETE FROM story_items WHERE item_id IN (SELECT id FROM items WHERE source_id = $1)`,
      [SRC],
    );
    await pool.query(`DELETE FROM stories WHERE original_source_id = $1`, [SRC]);
    await pool.query("DELETE FROM items WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM raw_contents WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM source_health WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM sources WHERE id = $1", [SRC]);
    await closePool();
  });

  t("groups exact dupes into one story with roles, idempotent on rerun", async () => {
    const pool = getPool();
    await seed(pool);
    const first = await clusterBatch(pool, { ...DEFAULT_WEIGHTS }, { sourceIds: [SRC] });
    expect(first.items_hashed).toBe(3);
    expect(first.stories_created).toBe(2);
    expect(first.items_linked).toBe(3);
    const stories = await pool.query(
      "SELECT id, source_count, score FROM stories WHERE original_source_id = $1 ORDER BY source_count DESC",
      [SRC],
    );
    expect(stories.rows).toHaveLength(2);
    expect(stories.rows[0].source_count).toBe(2);
    expect(stories.rows[0].score).toBeGreaterThan(0);
    const roles = await pool.query(
      `SELECT si.role FROM story_items si JOIN stories s ON s.id = si.story_id
       WHERE s.original_source_id = $1 AND s.source_count = 2 ORDER BY si.item_id`,
      [SRC],
    );
    expect(roles.rows.map((r) => r.role)).toEqual(["original", "discussion"]);
    const second = await clusterBatch(pool, { ...DEFAULT_WEIGHTS }, { sourceIds: [SRC] });
    expect(second.stories_created).toBe(0);
    expect(second.items_linked).toBe(0);
  }, 60000);
});
