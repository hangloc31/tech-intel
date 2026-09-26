import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../../infra/src/db.js";
import { asSearchDb, PgSearch } from "../../../infra/src/search.js";
import { upsertSource } from "../../../infra/src/store.js";

const hasDb = !!process.env.DATABASE_URL;
const t = hasDb ? it : it.skip;
const SRC = `test-search-${Date.now()}`;

describe("search integration", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    await pool.query("DELETE FROM items WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM raw_contents WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM source_health WHERE source_id = $1", [SRC]);
    await pool.query("DELETE FROM sources WHERE id = $1", [SRC]);
    await closePool();
  });

  t("ranks title matches and honors filters", async () => {
    const pool = getPool();
    await upsertSource(pool, { id: SRC, cadence_ms: 60000 }, "rss");
    await pool.query(
      `INSERT INTO items (source_id, external_id, title, url, canonical_url, published_at, content_type, summary, topics)
       VALUES ($1, 's1', 'Rust async runtimes compared', 'https://example.com/1', 'https://example.com/1', now(), 'article', 'tokio versus smol', ARRAY['Developer']),
              ($1, 's2', 'Gardening tips for spring', 'https://example.com/2', 'https://example.com/2', now(), 'article', 'a passing note comparing rust async runtimes in one sentence', ARRAY['Web'])`,
      [SRC],
    );
    const search = new PgSearch(asSearchDb(pool));
    const hits = await search.search("rust async runtimes", { source: SRC });
    expect(hits.length).toBe(2);
    // title-heavy match outranks body-only mention
    expect(hits[0].id).toBe(
      (await pool.query("SELECT id FROM items WHERE source_id = $1 AND external_id = 's1'", [SRC])).rows[0].id.toString(),
    );
    const topical = await search.search("rust", { source: SRC, topic: "Developer" });
    expect(topical).toHaveLength(1);
    expect(await search.search("", { source: SRC })).toEqual([]);
    expect(await search.search("rust", { source: SRC, topic: "Nope" })).toEqual([]);
  }, 60000);
});
