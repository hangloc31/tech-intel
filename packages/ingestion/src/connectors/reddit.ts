import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";
import { assertSafeUrl } from "./rss.js";

export interface RedditPostRaw {
  id?: string;
  name?: string;
  title?: string;
  url?: string;
  permalink?: string;
  author?: string;
  created_utc?: number;
  selftext?: string;
  over_18?: boolean;
  stickied?: boolean;
}

export function parseRedditPost(subreddit: string, p: RedditPostRaw): ParsedItem | null {
  if (!p || typeof p.id !== "string" || typeof p.title !== "string" || p.title.length === 0) return null;
  if (p.stickied === true) return null; // pinned mod posts are noise
  const url = p.url && p.url.startsWith("http") ? p.url : `https://www.reddit.com${p.permalink ?? `/r/${subreddit}/comments/${p.id}/`}`;
  const published = typeof p.created_utc === "number" ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString();
  return {
    external_id: `reddit:${p.id}`,
    title: p.title.slice(0, 300),
    url,
    author: p.author,
    published_at: published,
    summary: p.selftext ? p.selftext.slice(0, 500) || undefined : undefined,
    raw: { subreddit, post: p },
  };
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: {
      "user-agent": "tech-intel/0.1 (+attribution; respects robots)",
      accept: "application/json",
    },
    redirect: "manual",
  });
  if (res.status === 429) throw new Error("reddit rate-limited");
  if (res.status === 403) throw new Error("reddit forbidden (needs OAuth for this view)");
  if (!res.ok) throw new Error(`reddit http ${res.status}`);
  return JSON.parse((await res.text()).slice(0, 2_000_000)) as unknown;
}

/**
 * Reddit public-JSON connector (M6). Works keyless within tight rate limits;
 * enable selectively. OAuth app flow is backlog (see sources.yaml).
 */
export function createRedditConnector(
  opts: { id?: string; subreddit?: string; cadence_ms?: number; limit?: number } = {},
): SourceConnector {
  const id = opts.id ?? "reddit-machinelearning";
  const subreddit = opts.subreddit ?? "MachineLearning";
  const limit = Math.min(25, Math.max(1, opts.limit ?? 15));
  return {
    meta: () => ({ id, type: "api", cadence_ms: opts.cadence_ms ?? 600000, needs_auth: false }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
      assertSafeUrl(url);
      if (!/^[A-Za-z0-9_]+$/.test(subreddit)) throw new Error(`blocked subreddit: ${subreddit}`);
      ctx.log("reddit.fetch", { id, subreddit });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const onAbort = () => ctrl.abort();
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const data = (await getJson(url, ctrl.signal)) as { data?: { children?: Array<{ data?: RedditPostRaw }> } };
        for (const child of data.data?.children ?? []) {
          const p = child?.data;
          if (!p || typeof p.id !== "string") continue;
          yield {
            source_id: id,
            external_id: `reddit:${p.id}`,
            fetched_at: new Date().toISOString(),
            url: p.url ?? `https://www.reddit.com/r/${subreddit}/comments/${p.id}/`,
            raw: { subreddit, post: p },
          };
        }
      } finally {
        clearTimeout(t);
        ctx.signal.removeEventListener("abort", onAbort);
      }
    },
    parse: (raw: RawPayload) => {
      const { subreddit: s, post } = raw.raw as { subreddit: string; post: RedditPostRaw };
      const out = parseRedditPost(s, post);
      return out ? [out] : [];
    },
    normalize: (p: ParsedItem) => ({
      source_id: id,
      external_id: p.external_id,
      title: p.title,
      url: p.url,
      canonical_url: canonicalizeUrl(p.url),
      author: p.author,
      published_at: p.published_at,
      content_type: "discussion",
      summary: p.summary,
      topics: classifyTopics(p.title, p.summary ?? ""),
      entities: extractEntities(`${p.title} ${p.summary ?? ""}`),
    }),
  };
}
