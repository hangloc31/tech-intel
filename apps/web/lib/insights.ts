import { getPool } from "./db";

/**
 * Read-only aggregates for the right rail. Deliberately small, index-friendly
 * queries (all time-bounded) and never throws: the rail is decoration, so a
 * failure must not take the feed down with it.
 */

export interface TopicCount {
  topic: string;
  count: number;
}

export interface SourceCount {
  id: string;
  trust: number;
  count: number;
}

export interface Insights {
  storiesToday: number;
  itemsToday: number;
  sourcesToday: number;
  topics: TopicCount[];
  sources: SourceCount[];
}

const num = (v: unknown): number => Number(v ?? 0);

export async function loadInsights(topicWindowDays = 14, topicLimit = 10, sourceLimit = 6): Promise<Insights | null> {
  try {
    const pool = getPool();
    const [totals, topics, sources] = await Promise.all([
      pool.query(
        `SELECT count(*) FILTER (WHERE discovered_at > now() - interval '24 hours') AS items_today,
                count(DISTINCT source_id) FILTER (WHERE discovered_at > now() - interval '24 hours') AS sources_today
         FROM items`,
      ),
      pool.query(
        `SELECT t AS topic, count(*)::int AS count
         FROM items i, unnest(i.topics) AS t
         WHERE i.published_at > now() - make_interval(days => $1::int)
         GROUP BY 1 ORDER BY 2 DESC LIMIT $2::int`,
        [topicWindowDays, topicLimit],
      ),
      pool.query(
        `SELECT s.id, s.trust, count(*)::int AS count
         FROM items i JOIN sources s ON s.id = i.source_id
         WHERE i.published_at > now() - interval '7 days'
         GROUP BY s.id, s.trust ORDER BY count DESC, s.id LIMIT $1::int`,
        [sourceLimit],
      ),
    ]);
    const storiesToday = await pool.query(
      `SELECT count(*)::int AS c FROM stories WHERE first_seen_at > now() - interval '24 hours'`,
    );
    return {
      storiesToday: num(storiesToday.rows[0]?.c),
      itemsToday: num(totals.rows[0]?.items_today),
      sourcesToday: num(totals.rows[0]?.sources_today),
      topics: (topics.rows as Array<{ topic: string; count: number }>).map((r) => ({
        topic: r.topic,
        count: num(r.count),
      })),
      sources: (sources.rows as Array<{ id: string; trust: number; count: number }>).map((r) => ({
        id: r.id,
        trust: num(r.trust),
        count: num(r.count),
      })),
    };
  } catch {
    return null;
  }
}
