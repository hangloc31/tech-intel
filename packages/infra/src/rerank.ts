import type { Pool } from "pg";
import { score, type RankWeights } from "../../domain/src/rank.js";

/**
 * Re-scores stories so recency actually decays.
 *
 * `clusterBatch` writes `stories.score` once, at ingest time, using the story's
 * published_at as "now". Nothing ever recomputed it, so a story ingested while
 * fresh kept a ~0.65 score forever and outranked today's news on the Top tab.
 * This recomputes the same formula (owned by packages/domain) with the current
 * clock, in batches, so ranking is a function of time rather than of ingest.
 *
 * Stories outside the window keep their last score: they are old enough that
 * recency has decayed and they no longer compete for the top of the feed.
 */

export interface RerankOptions {
  /** Only stories first seen within this many hours are refreshed. Default 14d. */
  windowHours?: number;
  batchSize?: number;
  weights?: RankWeights;
  nowMs?: number;
}

export interface RerankStats {
  scanned: number;
  updated: number;
}

export async function rerankStories(pool: Pool, opts: RerankOptions = {}): Promise<RerankStats> {
  const windowHours = opts.windowHours ?? 24 * 14;
  const batchSize = opts.batchSize ?? 500;
  const weights = opts.weights;
  const nowMs = opts.nowMs ?? Date.now();
  const stats: RerankStats = { scanned: 0, updated: 0 };

  const res = await pool.query(
    `SELECT s.id, s.first_seen_at, s.source_count, COALESCE(src.trust, 0.5) AS trust
     FROM stories s LEFT JOIN sources src ON src.id = s.original_source_id
     WHERE s.first_seen_at > now() - make_interval(hours => $1::int)
     ORDER BY s.id`,
    [windowHours],
  );
  const rows = res.rows as Array<{ id: number; first_seen_at: string; source_count: number; trust: number }>;
  stats.scanned = rows.length;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const ids: number[] = [];
    const scores: number[] = [];
    for (const r of batch) {
      ids.push(Number(r.id));
      // first_seen_at holds the representative item's published_at (see clusterBatch),
      // so this reproduces the ingest-time inputs exactly — only `now` has moved.
      scores.push(
        score(
          {
            published_at: new Date(r.first_seen_at).toISOString(),
            source_trust: Number(r.trust),
            source_count: Number(r.source_count),
            engagement: 0,
          },
          weights,
          nowMs,
        ),
      );
    }
    const upd = await pool.query(
      `UPDATE stories AS s SET score = v.score, updated_at = now()
       FROM unnest($1::bigint[], $2::real[]) AS v(id, score)
       WHERE s.id = v.id AND s.score IS DISTINCT FROM v.score`,
      [ids, scores],
    );
    stats.updated += upd.rowCount ?? 0;
  }
  return stats;
}
