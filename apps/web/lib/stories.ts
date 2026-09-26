import { z } from "zod";
import { getPool } from "./db";

// NOTE: web reads Postgres directly (it owns the read side per ARCHITECTURE.md).
// Only type-only imports from packages/* (erased at compile); runtime dep is just `pg`.

export const TABS = ["top", "latest", "trending"] as const;
export type Tab = (typeof TABS)[number];

const listQuerySchema = z.object({
  tab: z.enum(TABS).optional().default("top"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  topic: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface CursorPayload {
  s: number | string;
  id: number;
}

export function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string): CursorPayload {
  let obj: unknown;
  try {
    obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw apiError(400, "bad_cursor", "cursor is not a valid opaque cursor");
  }
  const p = obj as Partial<CursorPayload>;
  if ((typeof p.s !== "number" && typeof p.s !== "string") || typeof p.id !== "number") {
    throw apiError(400, "bad_cursor", "cursor has invalid shape");
  }
  return { s: p.s, id: p.id };
}

export function apiError(status: number, code: string, message: string): { status: number; body: { code: string; message: string } } {
  return { status, body: { code, message } };
}

export function parseListQuery(input: Record<string, string | string[] | undefined>): ListQuery {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(input)) flat[k] = Array.isArray(v) ? v[0] : v;
  const r = listQuerySchema.safeParse(flat);
  if (!r.success) {
    throw apiError(400, "bad_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export interface StoryCard {
  id: number;
  title: string;
  summary: string | null;
  original_source_id: string | null;
  source_count: number;
  score: number;
  first_seen_at: string;
  updated_at: string;
  image_url: string | null;
  topics: string[];
  member_sources: string[];
  /** URL of the originating item — used to resolve a real favicon host. */
  origin_url: string | null;
}

/** Top-3 topics by member frequency. */
export function topTopics(items: Array<{ topics: string[] }>): string[] {
  const freq = new Map<string, number>();
  for (const i of items) for (const t of i.topics ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
}

export interface StoryItem {
  id: number;
  source_id: string;
  title: string;
  url: string;
  author: string | null;
  published_at: string;
  discovered_at: string;
  content_type: string;
  summary: string | null;
  image_url: string | null;
  topics: string[];
  entities: string[];
  role: string;
}

export interface StoryEnrichment {
  summary: string;
  why_it_matters: string;
  key_points: string[];
  model_name: string;
}

export interface StoryDetail extends StoryCard {
  items: StoryItem[];
  related: Array<{ id: number; title: string }>;
  enrichment: StoryEnrichment | null;
  /**
   * 1-based position in the Top ordering (same ORDER BY as the feed: score DESC,
   * id DESC). Shown instead of the raw score, which means nothing to readers.
   */
  top_rank: number | null;
  /** Trust of the originating source (sources.trust), one of the rank signals. */
  origin_trust: number | null;
}

/** The detail page always has real item URLs, so use the original item's. */
export function detailOriginUrl(items: StoryItem[]): string | null {
  return (items.find((i) => i.role === "original") ?? items[0])?.url ?? null;
}

const TRENDING_WINDOW_HOURS = Number(process.env.TRENDING_WINDOW_HOURS ?? 48);

/** Shared filter fragment for story list queries. Returns {where, params}. */
function storyFilters(q: ListQuery, startIdx: number): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = startIdx;
  if (q.topic) {
    params.push(q.topic);
    where.push(`EXISTS (SELECT 1 FROM story_items si JOIN items it ON it.id = si.item_id WHERE si.story_id = s.id AND it.topics @> ARRAY[$${i}::text])`);
    i++;
  }
  if (q.source) {
    params.push(q.source);
    where.push(`EXISTS (SELECT 1 FROM story_items si JOIN items it ON it.id = si.item_id WHERE si.story_id = s.id AND it.source_id = $${i})`);
    i++;
  }
  if (q.q) {
    // FTS (M4): plainto_tsquery never throws on punctuation (unlike to_tsquery).
    params.push(q.q.trim());
    where.push(`EXISTS (SELECT 1 FROM story_items si JOIN items it ON it.id = si.item_id WHERE si.story_id = s.id AND it.search @@ plainto_tsquery('english', $${i}))`);
    i++;
  }
  if (q.entity) {
    params.push(q.entity);
    where.push(`EXISTS (SELECT 1 FROM story_items si JOIN items it ON it.id = si.item_id WHERE si.story_id = s.id AND it.entities @> ARRAY[$${i}::text])`);
    i++;
  }
  return { where, params };
}

export async function listStories(query: ListQuery): Promise<{ stories: StoryCard[]; next_cursor: string | null }> {
  const pool = getPool();
  const { where, params } = storyFilters(query, 1);
  let orderBy: string;
  if (query.tab === "latest") {
    orderBy = "s.first_seen_at DESC, s.id DESC";
    where.push(`s.first_seen_at IS NOT NULL`);
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      if (typeof c.s !== "string") throw apiError(400, "bad_cursor", "cursor sort key must be a timestamp for tab=latest");
      params.push(c.s, c.id);
      where.push(`(s.first_seen_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length}::int)`);
    }
  } else {
    orderBy = "s.score DESC, s.id DESC";
    if (query.tab === "trending") {
      params.push(`${TRENDING_WINDOW_HOURS} hours`);
      where.push(`s.first_seen_at > now() - $${params.length}::interval`);
    }
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      if (typeof c.s !== "number") throw apiError(400, "bad_cursor", "cursor sort key must be a score for this tab");
      params.push(c.s, c.id);
      where.push(`(s.score, s.id) < ($${params.length - 1}::real, $${params.length}::int)`);
    }
  }
  params.push(query.limit + 1);
  const rows = (
    await pool.query(
      `SELECT s.id, s.title, s.summary, s.original_source_id, s.source_count, s.score,
              s.first_seen_at, s.updated_at, s.image_url
       FROM stories s
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${orderBy}
       LIMIT $${params.length}`,
      params,
    )
  ).rows as Array<{
    id: number;
    title: string;
    summary: string | null;
    original_source_id: string | null;
    source_count: number;
    score: number;
    first_seen_at: string;
    updated_at: string;
  }>;
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  let member_sources: Record<number, string[]> = {};
  let story_topics: Record<number, string[]> = {};
  const origin_urls = new Map<number, string>();
  if (page.length > 0) {
    const ids = page.map((r) => r.id);
    // member sources + the original item's URL. The URL is what makes a real
    // favicon possible: source ids are slugs ("hackernews"), not hostnames.
    const ms = await pool.query(
      `SELECT si.story_id,
              array_agg(DISTINCT it.source_id) AS sources,
              (array_agg(it.url ORDER BY (si.role = 'original') DESC, it.id))[1] AS origin_url
       FROM story_items si JOIN items it ON it.id = si.item_id
       WHERE si.story_id = ANY($1) GROUP BY si.story_id`,
      [ids],
    );
    const rows = ms.rows as Array<{ story_id: number; sources: string[]; origin_url: string | null }>;
    member_sources = Object.fromEntries(rows.map((r) => [r.story_id, r.sources]));
    for (const r of rows) if (r.origin_url) origin_urls.set(Number(r.story_id), r.origin_url);
    const ts = await pool.query(
      `SELECT si.story_id, it.topics FROM story_items si JOIN items it ON it.id = si.item_id
       WHERE si.story_id = ANY($1)`,
      [ids],
    );
    const byStory = new Map<number, Array<{ topics: string[] }>>();
    for (const r of ts.rows as Array<{ story_id: number; topics: string[] }>) {
      const g = byStory.get(Number(r.story_id)) ?? [];
      g.push({ topics: r.topics ?? [] });
      byStory.set(Number(r.story_id), g);
    }
    for (const [sid, items] of byStory) story_topics[sid] = topTopics(items);
  }
  const stories: StoryCard[] = page.map((r) => ({
    id: Number(r.id),
    title: r.title,
    summary: r.summary,
    original_source_id: r.original_source_id,
    source_count: Number(r.source_count),
    score: Number(r.score),
    first_seen_at: new Date(r.first_seen_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    image_url: (r as { image_url?: string | null }).image_url ?? null,
    topics: story_topics[Number(r.id)] ?? [],
    member_sources: member_sources[Number(r.id)] ?? [],
    origin_url: origin_urls.get(Number(r.id)) ?? null,
  }));
  let next_cursor: string | null = null;
  if (hasMore && stories.length > 0) {
    const last = stories[stories.length - 1];
    next_cursor = encodeCursor(
      query.tab === "latest" ? { s: last.first_seen_at, id: last.id } : { s: last.score, id: last.id },
    );
  }
  return { stories, next_cursor };
}

export async function getStory(id: number): Promise<StoryDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const pool = getPool();
  const s = await pool.query(
    `SELECT id, title, summary, original_source_id, source_count, score, first_seen_at, updated_at, image_url
     FROM stories WHERE id = $1`,
    [id],
  );
  if (s.rows.length === 0) return null;
  const itemsRes = await pool.query(
    `SELECT it.id, it.source_id, it.title, it.url, it.author, it.published_at, it.discovered_at,
            it.content_type, it.summary, it.topics, it.entities, it.image_url, si.role
     FROM story_items si JOIN items it ON it.id = si.item_id
     WHERE si.story_id = $1 ORDER BY it.published_at, it.id`,
    [id],
  );
  const row = s.rows[0] as Omit<StoryCard, "member_sources">;
  const score = Number(row.score);
  // Rank context for the "why this ranks" line. Two cheap lookups on a small
  // table; both run in parallel with the existing detail queries below.
  const [rankRes, trustRes] = await Promise.all([
    pool.query(`SELECT count(*)::int AS better FROM stories WHERE (score, id) > ($1::real, $2::int)`, [
      score,
      Number(row.id),
    ]),
    row.original_source_id
      ? pool.query(`SELECT trust FROM sources WHERE id = $1`, [row.original_source_id])
      : Promise.resolve({ rows: [] } as { rows: Array<{ trust: number }> }),
  ]);
  const top_rank = (rankRes.rows[0]?.better ?? 0) + 1;
  const origin_trust = trustRes.rows[0]?.trust ?? null;
  const items = (itemsRes.rows as Array<Omit<StoryItem, "id" | "image_url"> & { id: number | string; image_url: string | null }>).map((i) => ({
    ...i,
    id: Number(i.id),
    published_at: new Date(i.published_at).toISOString(),
    discovered_at: new Date(i.discovered_at).toISOString(),
  }));
  const rel = await pool.query(
    `SELECT s.id, s.title FROM story_links l
     JOIN stories s ON s.id = CASE WHEN l.story_a = $1 THEN l.story_b ELSE l.story_a END
     WHERE l.story_a = $1 OR l.story_b = $1 ORDER BY s.score DESC LIMIT 10`,
    [id],
  );
  const enr = await pool.query(
    `SELECT e.summary, e.why_it_matters, e.key_points, e.model_name
     FROM enrichments e JOIN story_items si ON si.item_id = e.item_id
     WHERE si.story_id = $1 ORDER BY e.created_at DESC LIMIT 1`,
    [id],
  );
  const er = enr.rows[0] as { summary: string; why_it_matters: string; key_points: unknown; model_name: string } | undefined;
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    original_source_id: row.original_source_id,
    source_count: Number(row.source_count),
    score: Number(row.score),
    first_seen_at: new Date(row.first_seen_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    image_url: (row as { image_url?: string | null }).image_url ?? null,
    topics: topTopics(items),
    member_sources: [...new Set(items.map((i) => i.source_id))],
    origin_url: detailOriginUrl(items),
    top_rank,
    origin_trust: origin_trust === null ? null : Number(origin_trust),
    items,
    related: (rel.rows as Array<{ id: number | string; title: string }>).map((r) => ({ id: Number(r.id), title: r.title })),
    enrichment: er
      ? {
          summary: er.summary,
          why_it_matters: er.why_it_matters,
          key_points: Array.isArray(er.key_points) ? (er.key_points as string[]) : [],
          model_name: er.model_name,
        }
      : null,
  };
}
