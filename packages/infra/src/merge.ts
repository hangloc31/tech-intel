import type { Pool, PoolClient } from "pg";
import { classifyPair, normalizeTitle, simHash } from "../../domain/src/dedup.js";
import { score } from "../../domain/src/rank.js";
import type { ClusterWeights } from "./cluster.js";

export interface MergeOpts {
  sourceIds?: string[];
  windowHours?: number;
  maxStories?: number;
}

export interface MergeStats {
  items_hashed: number;
  pairs_checked: number;
  stories_merged: number;
  items_relinked: number;
  links_created: number;
  stories_deleted: number;
}

interface CandMember {
  id: number;
  title: string;
  canonical_url: string;
  content_type: string;
  published_at: Date;
  entities: string[];
  source_id: string;
  trust: number;
  role: string;
  image_url: string | null;
}

interface CandStory {
  id: number;
  title: string;
  members: CandMember[];
}

function hex16(title: string): string {
  return simHash(title).toString(16).padStart(16, "0");
}

function entityUnion(s: CandStory): string[] {
  return [...new Set(s.members.flatMap((m) => m.entities))];
}

function sharesEntity(a: CandStory, b: CandStory): boolean {
  const sb = new Set(entityUnion(b));
  return entityUnion(a).some((e) => sb.has(e));
}

/**
 * M3 dedup pass: backfills simhash, then pairwise over recent candidate
 * stories — near_duplicate/same_story merge into one canonical story,
 * related pairs get a story_links row. Bounded and idempotent.
 */
export async function dedupMerge(
  pool: Pool,
  w: ClusterWeights,
  opts: MergeOpts = {},
): Promise<MergeStats> {
  const stats: MergeStats = {
    items_hashed: 0,
    pairs_checked: 0,
    stories_merged: 0,
    items_relinked: 0,
    links_created: 0,
    stories_deleted: 0,
  };
  const windowHours = opts.windowHours ?? 72;
  const maxStories = opts.maxStories ?? 2000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const srcFilter = opts.sourceIds ? "AND i.source_id = ANY($1)" : "";
    const srcParam = opts.sourceIds ? [opts.sourceIds] : [];
    // 1. Backfill simhash.
    const unhashed = await client.query(
      `SELECT i.id, i.title FROM items i WHERE i.simhash IS NULL ${srcFilter} LIMIT 2000`,
      srcParam,
    );
    const urows = unhashed.rows as Array<{ id: number; title: string }>;
    if (urows.length > 0) {
      await client.query(
        `UPDATE items AS i SET simhash = v.h
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::char(16)[]) AS h) AS v
         WHERE i.id = v.id`,
        [urows.map((r) => r.id), urows.map((r) => hex16(r.title))],
      );
      stats.items_hashed = urows.length;
    }
    // 2. Candidate stories (recent window) with members.
    const sRes = await client.query(
      `SELECT s.id, s.title FROM stories s
       WHERE s.first_seen_at > now() - make_interval(hours => $1)
       ${opts.sourceIds ? "AND EXISTS (SELECT 1 FROM story_items si JOIN items i ON i.id = si.item_id WHERE si.story_id = s.id AND i.source_id = ANY($2))" : ""}
       ORDER BY s.id LIMIT ${maxStories}`,
      opts.sourceIds ? [windowHours, opts.sourceIds] : [windowHours],
    );
    const storyRows = sRes.rows as Array<{ id: number; title: string }>;
    const stories = new Map<number, CandStory>();
    if (storyRows.length > 0) {
      const mRes = await client.query(
        `SELECT si.story_id, i.id, i.title, i.canonical_url, i.content_type,
                i.published_at, i.entities, i.source_id, i.image_url, COALESCE(s.trust, 0.5) AS trust, si.role
         FROM story_items si
         JOIN items i ON i.id = si.item_id
         LEFT JOIN sources s ON s.id = i.source_id
         WHERE si.story_id = ANY($1) ORDER BY si.story_id, i.published_at, i.id`,
        [storyRows.map((r) => r.id)],
      );
      for (const r of mRes.rows as Array<CandMember & { story_id: number }>) {
        const st = stories.get(r.story_id) ?? { id: r.story_id, title: "", members: [] };
        st.members.push(r);
        stories.set(r.story_id, st);
      }
      for (const r of storyRows) {
        const st = stories.get(r.id);
        if (st) st.title = r.title;
        else stories.delete(r.id);
      }
    }
    const list = [...stories.values()];
    const alive = new Set(list.map((s) => s.id));
    // 3a. Blocking: same normalized title OR shared entity (avoids full O(n^2)).
    const pairs: Array<[CandStory, CandStory]> = [];
    const seen = new Set<string>();
    const consider = (A: CandStory, B: CandStory) => {
      const k = A.id < B.id ? `${A.id},${B.id}` : `${B.id},${A.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        pairs.push([A, B]);
      }
    };
    const byTitle = new Map<string, CandStory[]>();
    for (const s of list) {
      const k = normalizeTitle(s.title);
      const g = byTitle.get(k) ?? [];
      g.push(s);
      byTitle.set(k, g);
    }
    for (const g of byTitle.values()) {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) consider(g[i], g[j]);
    }
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        if (sharesEntity(list[a], list[b])) consider(list[a], list[b]);
      }
    }
    // 3b. Pairwise decisions.
    for (const [A, B] of pairs) {
      if (!alive.has(A.id) || !alive.has(B.id)) continue;
      const repA = {
        source_id: A.members[0].source_id,
        external_id: "",
        title: A.title,
        url: "",
        canonical_url: A.members[0].canonical_url,
        published_at: new Date(A.members[0].published_at).toISOString(),
        content_type: "article" as const,
        topics: [],
        entities: entityUnion(A),
      };
      const repB = {
        source_id: B.members[0].source_id,
        external_id: "",
        title: B.title,
        url: "",
        canonical_url: B.members[0].canonical_url,
        published_at: new Date(B.members[0].published_at).toISOString(),
        content_type: "article" as const,
        topics: [],
        entities: entityUnion(B),
      };
      stats.pairs_checked++;
      const kind = classifyPair(repA, repB);
      if (kind === "exact" || kind === "near_duplicate" || kind === "same_story") {
        // Merge smaller into larger (tie: lower id wins).
        const target = A.members.length >= B.members.length ? A : B;
        const victim = target === A ? B : A;
        await mergeStories(client, target, victim, w);
        alive.delete(victim.id);
        stats.stories_merged++;
        stats.items_relinked += victim.members.length;
        stats.stories_deleted++;
        // Refresh target members for subsequent pairs.
        target.members = [...target.members, ...victim.members].sort(
          (x, y) => +new Date(x.published_at) - +new Date(y.published_at) || x.id - y.id,
        );
      } else if (kind === "related") {
        const lo = Math.min(A.id, B.id);
        const hi = Math.max(A.id, B.id);
        const ins = await client.query(
          `INSERT INTO story_links (story_a, story_b, kind) VALUES ($1, $2, 'related')
           ON CONFLICT (story_a, story_b) DO NOTHING`,
          [lo, hi],
        );
        stats.links_created += ins.rowCount ?? 0;
      }
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

async function mergeStories(client: PoolClient, target: CandStory, victim: CandStory, w: ClusterWeights): Promise<void> {
  // Move links pointing at victim onto target (drop self-links / dupes).
  const links = await client.query("SELECT story_a, story_b FROM story_links WHERE story_a = $1 OR story_b = $1", [victim.id]);
  await client.query("DELETE FROM story_links WHERE story_a = $1 OR story_b = $1", [victim.id]);
  for (const l of links.rows as Array<{ story_a: number; story_b: number }>) {
    const other = l.story_a === victim.id ? l.story_b : l.story_a;
    if (other === target.id) continue;
    await client.query(
      `INSERT INTO story_links (story_a, story_b, kind) VALUES (LEAST($1,$2), GREATEST($1,$2), 'related')
       ON CONFLICT (story_a, story_b) DO NOTHING`,
      [target.id, other],
    );
  }
  // Move items.
  await client.query("UPDATE story_items SET story_id = $1 WHERE story_id = $2", [target.id, victim.id]);
  // Recompute canonical fields from merged membership.
  const mRes = await client.query(
    `SELECT i.id, i.title, i.summary, i.source_id, i.content_type, i.published_at, i.image_url, COALESCE(s.trust, 0.5) AS trust
     FROM story_items si JOIN items i ON i.id = si.item_id
     LEFT JOIN sources s ON s.id = i.source_id
     WHERE si.story_id = $1 ORDER BY i.published_at, i.id`,
    [target.id],
  );
  const members = mRes.rows as Array<{
    id: number;
    title: string;
    summary: string | null;
    source_id: string;
    content_type: string;
    published_at: Date;
    image_url: string | null;
    trust: number;
  }>;
  const first = members[0];
  const img = members.find((m) => m.image_url)?.image_url ?? null;
  const s = score(
    { published_at: new Date(first.published_at).toISOString(), source_trust: first.trust, source_count: members.length, engagement: 0 },
    { ...w },
  );
  await client.query(
    `UPDATE stories SET title = $2, summary = $3, original_source_id = $4,
       source_count = $5, score = $6, first_seen_at = $7, image_url = COALESCE($8, image_url), updated_at = now() WHERE id = $1`,
    [target.id, first.title, first.summary, first.source_id, members.length, s, first.published_at, img],
  );
  // Roles: earliest published is original; others derive from content type.
  await client.query(
    `UPDATE story_items si SET role = CASE
       WHEN si.item_id = $2 THEN 'original'
       WHEN i.content_type = 'discussion' THEN 'discussion'
       ELSE 'secondary' END
     FROM items i WHERE si.story_id = $1 AND i.id = si.item_id`,
    [target.id, first.id],
  );
  await client.query("DELETE FROM stories WHERE id = $1", [victim.id]);
}
