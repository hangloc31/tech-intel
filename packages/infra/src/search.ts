import type { Pool } from "pg";
import type { SearchFilters, SearchPort } from "./ports.js";

// NOTE: only bare (`pg`) + type-only relative imports here, so Next.js can
// bundle this file via an extensionless import (webpack can't resolve
// TS-style `.js` -> `.ts` specifiers).

export type { SearchFilters };

export interface SearchHit {
  id: string;
  score: number;
}

/** Minimal DB surface so callers can inject pg.Pool (or a stub in tests). */
export interface SearchDb {
  query(text: string, params: unknown[]): Promise<{ rows: Array<{ id: unknown; score: unknown }> }>;
}

/** Postgres FTS implementation of SearchPort (M4). Swap to Typesense later. */
export class PgSearch implements SearchPort {
  private readonly db: SearchDb;

  constructor(db: SearchDb) {
    this.db = db;
  }

  async indexItem(): Promise<void> {
    // No-op: items.search is a generated tsvector column, always current.
  }

  async search(q: string, filters: SearchFilters = {}): Promise<SearchHit[]> {
    if (!q.trim()) return [];
    const where: string[] = [`i.search @@ plainto_tsquery('english', $1)`];
    const params: unknown[] = [q.trim()];
    if (filters.topic) {
      params.push(filters.topic);
      where.push(`i.topics @> ARRAY[$${params.length}::text]`);
    }
    if (filters.source) {
      params.push(filters.source);
      where.push(`i.source_id = $${params.length}`);
    }
    if (filters.author) {
      params.push(`%${filters.author.replace(/[%_\\]/g, "")}%`);
      where.push(`i.author ILIKE $${params.length}`);
    }
    if (filters.entity) {
      params.push(filters.entity);
      where.push(`i.entities @> ARRAY[$${params.length}::text]`);
    }
    if (filters.date_from) {
      params.push(filters.date_from);
      where.push(`i.published_at >= $${params.length}::timestamptz`);
    }
    if (filters.date_to) {
      params.push(filters.date_to);
      where.push(`i.published_at <= $${params.length}::timestamptz`);
    }
    params.push(Math.min(50, Math.max(1, filters.limit ?? 20)));
    const rows = (
      await this.db.query(
        `SELECT i.id, ts_rank_cd(i.search, plainto_tsquery('english', $1)) AS score
         FROM items i WHERE ${where.join(" AND ")}
         ORDER BY score DESC, i.published_at DESC
         LIMIT $${params.length}`,
        params,
      )
    ).rows;
    return rows.map((r) => ({ id: String(r.id), score: Number(r.score) }));
  }
}

export function asSearchDb(db: Pool): SearchDb {
  return {
    query: (text, params) => db.query(text, params as never[]) as unknown as Promise<{ rows: Array<{ id: unknown; score: unknown }> }>,
  };
}
