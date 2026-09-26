import type { FetchCtx, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

const HN_BASE = process.env.HN_API_BASE ?? "https://hacker-news.firebaseio.com/v0";

async function getJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "tech-intel/0.1 (+attribution; respects robots)" },
    });
    if (!res.ok) throw new Error(`hn http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export interface HnItemRaw {
  id: number;
  title?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  deleted?: boolean;
  dead?: boolean;
  type?: string;
}

/** Deleted/dead/missing items are skipped quietly (common on HN). */
export function isUsableHnItem(item: HnItemRaw | null | undefined): item is HnItemRaw {
  return !!item && !item.deleted && !item.dead && typeof item.title === "string" && item.title.length > 0;
}

export function createHnConnector(): SourceConnector {
  return {
    meta: () => ({ id: "hackernews", type: "api", cadence_ms: 300000, needs_auth: false }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      ctx.log("hn.fetch.topstories");
      const ids = (await getJson(`${HN_BASE}/topstories.json`)) as number[];
      for (const id of ids.slice(0, 30)) {
        const item = (await getJson(`${HN_BASE}/item/${id}.json`)) as HnItemRaw | null;
        if (!isUsableHnItem(item)) continue;
        yield {
          source_id: "hackernews",
          external_id: String(item.id),
          fetched_at: new Date().toISOString(),
          url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
          raw: item,
        };
      }
    },
    parse: (raw: RawPayload) => {
      const r = raw.raw as { id: number; title: string; url?: string; by?: string; time?: number };
      return [{
        external_id: String(r.id),
        title: r.title,
        url: r.url ?? `https://news.ycombinator.com/item?id=${r.id}`,
        author: r.by,
        published_at: new Date((r.time ?? Date.now() / 1000) * 1000).toISOString(),
        raw: r,
      }];
    },
    normalize: (p) => ({
      source_id: "hackernews",
      external_id: p.external_id,
      title: p.title,
      url: p.url,
      canonical_url: canonicalizeUrl(p.url),
      author: p.author,
      published_at: p.published_at,
      content_type: "discussion",
      topics: classifyTopics(p.title),
      entities: extractEntities(p.title),
    }),
  };
}
