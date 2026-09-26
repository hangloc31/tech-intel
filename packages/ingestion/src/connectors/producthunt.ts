import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

export interface ProductHuntPostRaw {
  id?: string | number;
  name?: string;
  tagline?: string;
  url?: string;
  website?: string;
  createdAt?: string;
}

export function parseProductHuntPost(p: ProductHuntPostRaw): ParsedItem | null {
  if (!p || p.id === undefined || typeof p.name !== "string" || p.name.length === 0) return null;
  const url = p.url ?? (typeof p.id === "number" ? `https://www.producthunt.com/posts/${p.id}` : `https://www.producthunt.com/p/${p.id}`);
  return {
    external_id: `ph:${p.id}`,
    title: `${p.name}${p.tagline ? ` — ${p.tagline}` : ""}`.slice(0, 300),
    url,
    published_at: p.createdAt && !Number.isNaN(Date.parse(p.createdAt)) ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    summary: p.tagline?.slice(0, 500),
    raw: { post: p },
  };
}

/**
 * Product Hunt provider abstraction (M6). Requires PRODUCTHUNT_TOKEN
 * (Developer API); without it the connector refuses to run so the
 * scheduler never burns quota or logs noise.
 */
export function createProductHuntConnector(opts: { id?: string; cadence_ms?: number } = {}): SourceConnector {
  const id = opts.id ?? "producthunt";
  const token = (): string => {
    const t = process.env.PRODUCTHUNT_TOKEN;
    if (!t) throw new Error("producthunt disabled (needs PRODUCTHUNT_TOKEN)");
    return t;
  };
  return {
    meta: () => ({ id, type: "api", cadence_ms: opts.cadence_ms ?? 3600000, needs_auth: true }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      token();
      ctx.log("producthunt.fetch", { id });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token()}`,
            "user-agent": "tech-intel/0.1",
          },
          body: JSON.stringify({
            query: "{ posts(first: 10, order: RANKING) { edges { node { id name tagline url createdAt } } } }",
          }).slice(0, 100000),
        });
        if (res.status === 401 || res.status === 403) throw new Error("producthunt auth failed");
        if (res.status === 429) throw new Error("producthunt rate-limited");
        if (!res.ok) throw new Error(`producthunt http ${res.status}`);
        const data = (await res.json()) as { data?: { posts?: { edges?: Array<{ node?: ProductHuntPostRaw }> } } };
        for (const edge of data.data?.posts?.edges ?? []) {
          const p = edge?.node;
          if (!p || p.id === undefined) continue;
          yield {
            source_id: id,
            external_id: `ph:${p.id}`,
            fetched_at: new Date().toISOString(),
            url: p.url ?? "https://www.producthunt.com",
            raw: { post: p },
          };
        }
      } finally {
        clearTimeout(t);
      }
    },
    parse: (raw: RawPayload) => {
      const out = parseProductHuntPost((raw.raw as { post: ProductHuntPostRaw }).post);
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
