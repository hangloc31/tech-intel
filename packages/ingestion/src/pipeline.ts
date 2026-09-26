import type { NormalizedItem } from "../../domain/src/types.js";
import type { ParsedItem, RawPayload, SourceConnector } from "./ports.js";
import { createRssConnector } from "./connectors/rss.js";
import { createHnConnector } from "./connectors/hackernews.js";
import { createGithubConnector } from "./connectors/github.js";

export interface RunResult {
  source_id: string;
  fetched: number;
  parsed: number;
  normalized: number;
  /** Dropped by the freshness window (archive feeds carry full history). */
  filtered_stale: number;
  /** Dropped by the per-source cap (keeps the newest). */
  filtered_cap: number;
  stored: number;
  errors: string[];
}

export interface PersistItem {
  raw: unknown;
  fetched_at: string;
  url: string;
  normalized: NormalizedItem;
}

/** Optional DB sink (composition root injects it; unit runs omit it). */
export type PersistSink = (
  source_id: string,
  items: PersistItem[],
) => Promise<{ raw_inserted: number; items_upserted: number }>;

export interface RunOpts {
  sink?: PersistSink;
  /** fetch retries on transient errors (default 2). Rate-limit errors never retry. */
  fetchRetries?: number;
  /**
   * Freshness window in days (default 30). Items with `published_at` older than
   * this are dropped before persist — archive feeds (openai-blog, huggingface-blog)
   * otherwise re-ingest years of history on every run and drown out fresh news.
   * Values <= 0 disable the filter.
   */
  maxAgeDays?: number;
  /**
   * Per-source cap (default 100). After the age filter, only the N newest
   * normalized items are persisted. Values <= 0 disable the cap.
   */
  maxItemsPerSource?: number;
  /** Clock injection (AGENTS.md: no Date.now() without injection). */
  nowMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitedError(e: unknown): boolean {
  return /rate-limited/i.test((e as Error)?.message ?? "");
}

/** Runs each connector once with per-source isolation: one source failing never stops others. */
export async function runOnce(connectors: SourceConnector[], opts: RunOpts = {}): Promise<RunResult[]> {
  const retries = opts.fetchRetries ?? 2;
  const maxAgeMs = (opts.maxAgeDays ?? 30) > 0 ? (opts.maxAgeDays ?? 30) * 86_400_000 : Infinity;
  const cap = opts.maxItemsPerSource ?? 100;
  const nowMs = opts.nowMs ?? Date.now();
  const results: RunResult[] = [];
  for (const c of connectors) {
    const id = c.meta().id;
    const r: RunResult = {
      source_id: id,
      fetched: 0,
      parsed: 0,
      normalized: 0,
      filtered_stale: 0,
      filtered_cap: 0,
      stored: 0,
      errors: [],
    };
    const batch: PersistItem[] = [];
    const ctx = { signal: AbortSignal.timeout(30000), log: () => {} };
    // Fetch with retry/backoff. Rate-limit aborts immediately (scheduler backs off).
    let raws: RawPayload[] = [];
    let fetchErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        raws = [];
        for await (const raw of c.fetch(ctx)) raws.push(raw);
        fetchErr = null;
        break;
      } catch (e) {
        fetchErr = e;
        if (isRateLimitedError(e) || ctx.signal.aborted || attempt === retries) break;
        await sleep(1000 * 2 ** attempt + Math.random() * 500);
      }
    }
    if (fetchErr) {
      r.errors.push(`fetch: ${(fetchErr as Error).message}`);
      results.push(r);
      continue;
    }
    for (const raw of raws) {
      r.fetched++;
      let parsed: ParsedItem[];
      try {
        parsed = c.parse(raw);
      } catch (e) {
        r.errors.push(`parse: ${(e as Error).message}`);
        continue;
      }
      for (const p of parsed) {
        r.parsed++;
        try {
          const normalized = c.normalize(p);
          r.normalized++;
          // Freshness window. Unparseable dates are kept: absence of evidence
          // is not evidence of staleness (several connectors default to now).
          const t = Date.parse(normalized.published_at);
          if (Number.isFinite(t) && nowMs - t > maxAgeMs) {
            r.filtered_stale++;
            continue;
          }
          batch.push({ raw: p.raw, fetched_at: raw.fetched_at, url: p.url, normalized });
        } catch (e) {
          r.errors.push(`normalize: ${(e as Error).message}`);
        }
      }
    }
    // Per-source cap: keep the newest. Stable sort, so equal timestamps keep
    // connector order and one bad date never sinks the whole batch.
    if (cap > 0 && batch.length > cap) {
      batch.sort((a, b) => {
        const ta = Date.parse(a.normalized.published_at);
        const tb = Date.parse(b.normalized.published_at);
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        return tb - ta;
      });
      r.filtered_cap = batch.length - cap;
      batch.length = cap;
    }
    if (opts.sink && batch.length > 0) {
      try {
        const s = await opts.sink(id, batch);
        r.stored = s.items_upserted;
      } catch (e) {
        r.errors.push(`persist: ${(e as Error).message}`);
      }
    }
    results.push(r);
  }
  return results;
}

export function defaultConnectors(): SourceConnector[] {
  return [
    createHnConnector(),
    createGithubConnector(),
    createRssConnector({ id: "techcrunch", url: "https://techcrunch.com/feed/" }),
    createRssConnector({ id: "openai-blog", url: "https://openai.com/news/rss.xml" }),
  ];
}
