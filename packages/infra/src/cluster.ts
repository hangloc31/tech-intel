import type { Pool } from "pg";
import { contentHash } from "../../domain/src/dedup.js";
import { score } from "../../domain/src/rank.js";

export interface ClusterWeights {
  recency: number;
  trust: number;
  cross_source: number;
  engagement: number;
  half_life_hours: number;
}

export interface ClusterStats {
  items_hashed: number;
  stories_created: number;
  stories_updated: number;
  items_linked: number;
}

export interface ClusterOpts {
  /** Scope to these sources (tests / per-source runs). Default: all. */
  sourceIds?: string[];
  /** Max hash groups per run. Default 500. */
  groupLimit?: number;
}

interface MemberRow {
  id: number;
  hash: string;
  title: string;
  summary: string | null;
  source_id: string;
  content_type: string;
  published_at: Date;
  trust: number;
  image_url: string | null;
}

/** Story image: earliest member that has one (null = UI hides the thumbnail). */
function storyImage(members: MemberRow[]): string | null {
  return members.find((m) => m.image_url)?.image_url ?? null;
}

/**
 * v0 clustering: exact contentHash groups -> one story each.
 * Set-based (constant round-trips regardless of scale), idempotent:
 * reruns only touch groups with unclustered items.
 * M3 upgrades matching to SimHash + 72h window + entity overlap.
 */
export async function clusterBatch(
  pool: Pool,
  w: ClusterWeights,
  opts: ClusterOpts = {},
): Promise<ClusterStats> {
  const stats: ClusterStats = { items_hashed: 0, stories_created: 0, stories_updated: 0, items_linked: 0 };
  const groupLimit = opts.groupLimit ?? 2000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const srcFilter = opts.sourceIds ? "AND i.source_id = ANY($1)" : "";
    const srcParam = opts.sourceIds ? [opts.sourceIds] : [];
    // 1. Backfill missing content hashes (single round-trip).
    const unhashed = await client.query(
      `SELECT i.id, i.title, i.canonical_url FROM items i
       WHERE i.content_hash IS NULL ${srcFilter} LIMIT 2000`,
      srcParam,
    );
    const urows = unhashed.rows as Array<{ id: number; title: string; canonical_url: string }>;
    if (urows.length > 0) {
      await client.query(
        `UPDATE items AS i SET content_hash = v.h
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::char(64)[]) AS h) AS v
         WHERE i.id = v.id`,
        [
          urows.map((r) => r.id),
          urows.map((r) => contentHash({ title: r.title, canonical_url: r.canonical_url })),
        ],
      );
      stats.items_hashed = urows.length;
    }
    // 2. All unclustered members with source trust (single round-trip).
    const mRes = await client.query(
      `SELECT i.id, i.content_hash AS hash, i.title, i.summary, i.source_id,
              i.content_type, i.published_at, i.image_url, COALESCE(s.trust, 0.5) AS trust
       FROM items i
       LEFT JOIN story_items si ON si.item_id = i.id
       LEFT JOIN sources s ON s.id = i.source_id
       WHERE i.content_hash IS NOT NULL AND si.item_id IS NULL ${srcFilter}
       ORDER BY i.content_hash, i.published_at, i.id`,
      srcParam,
    );
    const groups = new Map<string, MemberRow[]>();
    for (const r of mRes.rows as MemberRow[]) {
      const g = groups.get(r.hash) ?? [];
      g.push(r);
      groups.set(r.hash, g);
    }
    const hashes = [...groups.keys()].slice(0, groupLimit);
    if (hashes.length === 0) {
      await client.query("COMMIT");
      return stats;
    }
    const existed = await client.query("SELECT content_hash AS hash FROM stories WHERE content_hash = ANY($1)", [hashes]);
    const existing = new Set((existed.rows as Array<{ hash: string }>).map((r) => r.hash));
    // 3. Batch story upserts (single round-trip). Score from pure domain scorer.
    const titles: string[] = [];
    const summaries: Array<string | null> = [];
    const origins: string[] = [];
    const counts: number[] = [];
    const scores: number[] = [];
    const firstSeen: string[] = [];
    const images: Array<string | null> = [];
    const roles = new Map<number, string>(); // item_id -> role
    const storyOf = new Map<string, number>(); // hash -> index (filled after RETURNING)
    for (const h of hashes) {
      const members = groups.get(h)!;
      const first = members[0];
      titles.push(first.title);
      summaries.push(first.summary);
      origins.push(first.source_id);
      counts.push(members.length);
      scores.push(
        score(
          {
            published_at: new Date(first.published_at).toISOString(),
            source_trust: first.trust,
            source_count: members.length,
            engagement: 0,
          },
          { ...w },
        ),
      );
      firstSeen.push(new Date(first.published_at).toISOString());
      images.push(storyImage(members));
      members.forEach((m, i) => roles.set(m.id, i === 0 ? "original" : m.content_type === "discussion" ? "discussion" : "secondary"));
      if (existing.has(h)) stats.stories_updated++;
      else stats.stories_created++;
    }
    const sRes = await client.query(
      `INSERT INTO stories (title, summary, original_source_id, source_count, score, first_seen_at, content_hash, image_url)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::real[], $6::timestamptz[], $7::char(64)[], $8::text[])
       ON CONFLICT (content_hash) DO UPDATE SET
         source_count = EXCLUDED.source_count, score = EXCLUDED.score, updated_at = now(),
         image_url = COALESCE(EXCLUDED.image_url, stories.image_url)
       RETURNING id, content_hash AS hash`,
      [titles, summaries, origins, counts, scores, firstSeen, hashes, images],
    );
    for (const r of sRes.rows as Array<{ id: number; hash: string }>) storyOf.set(r.hash, r.id);
    // 4. Batch story_items links (single round-trip).
    const linkStory: number[] = [];
    const linkItem: number[] = [];
    const linkRole: string[] = [];
    for (const h of hashes) {
      const sid = storyOf.get(h);
      if (sid === undefined) continue;
      for (const m of groups.get(h)!) {
        linkStory.push(sid);
        linkItem.push(m.id);
        linkRole.push(roles.get(m.id)!);
      }
    }
    if (linkItem.length > 0) {
      const lRes = await client.query(
        `INSERT INTO story_items (story_id, item_id, role)
         SELECT * FROM unnest($1::int[], $2::int[], $3::text[])
         ON CONFLICT (story_id, item_id) DO NOTHING`,
        [linkStory, linkItem, linkRole],
      );
      stats.items_linked = lRes.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return stats;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
