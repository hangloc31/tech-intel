import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

export interface XPostRaw {
  id?: string;
  text?: string;
  author?: string;
  created_at?: string;
  url?: string;
}

export function parseXPost(p: XPostRaw): ParsedItem | null {
  if (!p || typeof p.id !== "string" || typeof p.text !== "string" || p.text.length === 0) return null;
  return {
    external_id: `x:${p.id}`,
    title: p.text.slice(0, 300),
    url: p.url ?? `https://x.com/${p.author ?? "i"}/status/${p.id}`,
    author: p.author,
    published_at: p.created_at && !Number.isNaN(Date.parse(p.created_at)) ? new Date(p.created_at).toISOString() : new Date().toISOString(),
    raw: { post: p },
  };
}

/**
 * X provider abstraction (M6). No free API tier fits this product, so the
 * connector is parse-ready but refuses to fetch without X_API_BEARER.
 * Stays disabled until keys + query pack are configured.
 */
export function createXConnector(opts: { id?: string; cadence_ms?: number } = {}): SourceConnector {
  const id = opts.id ?? "x-tech";
  return {
    meta: () => ({ id, type: "api", cadence_ms: opts.cadence_ms ?? 300000, needs_auth: true }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      if (!process.env.X_API_BEARER) throw new Error("x disabled (needs X_API_BEARER)");
      ctx.log("x.fetch", { id });
      // Query pack (lists/search streams) lands here once access is granted.
      // Deliberately yields nothing until then: no fake data in prod path.
      return;
    },
    parse: (raw: RawPayload) => {
      const out = parseXPost((raw.raw as { post: XPostRaw }).post);
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
      content_type: "post",
      summary: p.summary,
      topics: classifyTopics(p.title, p.summary ?? ""),
      entities: extractEntities(`${p.title} ${p.summary ?? ""}`),
    }),
  };
}
