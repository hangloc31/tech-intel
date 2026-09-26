import { z } from "zod";
import { asSearchDb, PgSearch } from "../../../packages/infra/src/search";
import { apiError, type StoryCard } from "./stories";
import { getPool } from "./db";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  topic: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  author: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchResult {
  story: StoryCard;
  score: number;
  snippet: string | null;
}

export function parseSearchQuery(input: Record<string, string | undefined>): SearchQuery {
  const r = searchQuerySchema.safeParse(input);
  if (!r.success) {
    throw apiError(400, "bad_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

/** FTS over items via SearchPort, mapped up to parent stories. */
export async function searchStories(query: SearchQuery): Promise<{ results: SearchResult[] }> {
  const pool = getPool();
  const port = new PgSearch(asSearchDb(pool));
  const hits = await port.search(query.q, {
    topic: query.topic,
    source: query.source,
    author: query.author,
    entity: query.entity,
    limit: query.limit,
  });
  if (hits.length === 0) return { results: [] };
  const itemIds = hits.map((h) => Number(h.id));
  const scoreByItem = new Map(hits.map((h) => [Number(h.id), h.score]));
  const stories = await pool.query(
    `SELECT DISTINCT ON (s.id) s.id, s.title, s.summary, s.original_source_id, s.source_count,
            s.score, s.first_seen_at, s.updated_at, s.image_url
     FROM stories s JOIN story_items si ON si.story_id = s.id
     WHERE si.item_id = ANY($1)`,
    [itemIds],
  );
  const rows = stories.rows as Array<
    Omit<StoryCard, "id" | "score" | "source_count" | "member_sources" | "origin_url" | "image_url"> & {
      id: number | string;
      score: unknown;
      source_count: unknown;
      image_url: string | null;
    }
  >;
  // Best item score per story (second lookup keeps query count constant).
  const perStory = await pool.query(
    `SELECT si.story_id, si.item_id, si.role, it.source_id, it.url
     FROM story_items si JOIN items it ON it.id = si.item_id
     WHERE si.item_id = ANY($1)`,
    [itemIds],
  );
  const bestByStory = new Map<number, number>();
  // Source ids + the originating item URL per story, so cards render a real
  // favicon instead of guessing a hostname from a slug.
  const sourceByStory = new Map<number, string[]>();
  const originUrlByStory = new Map<number, string>();
  for (const l of perStory.rows as Array<{ story_id: number | string; item_id: number | string; source_id: string; url: string; role: string }>) {
    const s = Number(l.story_id);
    const sc = scoreByItem.get(Number(l.item_id)) ?? 0;
    if (sc > (bestByStory.get(s) ?? -1)) {
      bestByStory.set(s, sc);
      originUrlByStory.set(s, l.url);
    }
    const list = sourceByStory.get(s) ?? [];
    if (!list.includes(l.source_id)) list.push(l.source_id);
    sourceByStory.set(s, list);
  }
  const results: SearchResult[] = rows
    .map((row) => {
      const sid = Number(row.id);
      return {
        story: {
          id: sid,
          title: row.title,
          summary: row.summary,
          original_source_id: row.original_source_id,
          source_count: Number(row.source_count),
          score: Number(row.score),
          first_seen_at: new Date(row.first_seen_at).toISOString(),
          updated_at: new Date(row.updated_at).toISOString(),
          image_url: row.image_url,
          topics: [],
          member_sources: sourceByStory.get(sid) ?? [],
          origin_url: originUrlByStory.get(sid) ?? null,
        },
        score: bestByStory.get(sid) ?? 0,
        snippet: null as string | null,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit);
  // Snippet from the best-matching item per story.
  for (const r of results) {
    const snip = await pool.query(
      `SELECT ts_headline('english', it.title || ' ' || COALESCE(it.summary, ''), plainto_tsquery('english', $1),
                          'MaxWords=24, MinWords=8, ShortWord=3') AS snip
       FROM story_items si JOIN items it ON it.id = si.item_id
       WHERE si.story_id = $2 AND it.search @@ plainto_tsquery('english', $1)
       ORDER BY ts_rank_cd(it.search, plainto_tsquery('english', $1)) DESC LIMIT 1`,
      [query.q.trim(), r.story.id],
    );
    r.snippet = (snip.rows[0]?.snip as string | null) ?? null;
  }
  return { results };
}
