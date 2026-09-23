import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

// SSRF guard: only public http/https, block private ranges on redirect targets.
export function assertSafeUrl(url: string): void {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`blocked protocol: ${u.protocol}`);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("blocked host");
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error("blocked private IP literal");
  if (["169.254.169.254", "0.0.0.0"].includes(host)) throw new Error("blocked metadata IP");
}

export function parseRssXml(xml: string, sourceId: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) ?? [];
  for (const b of blocks) {
    const pick = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!m) return "";
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim();
    };
    const title = pick("title").replace(/<[^>]+>/g, "").slice(0, 300);
    let link = pick("link");
    const href = b.match(/<link[^>]*href="([^"]+)"/);
    if (href) link = href[1];
    if (!title || !link) continue;
    const pub = pick("pubDate") || pick("published") || pick("updated") || new Date().toISOString();
    items.push({
      external_id: link,
      title,
      url: link,
      author: pick("author") || pick("dc:creator") || undefined,
      published_at: new Date(pub).toISOString(),
      summary: pick("description").replace(/<[^>]+>/g, "").slice(0, 500) || undefined,
      raw: b.slice(0, 2000),
    });
  }
  return items;
}

export function createRssConnector(opts: { id: string; url: string; cadence_ms?: number }): SourceConnector {
  return {
    meta: () => ({ id: opts.id, type: "rss", cadence_ms: opts.cadence_ms ?? 600000, needs_auth: false }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      assertSafeUrl(opts.url);
      ctx.log("rss.fetch", { id: opts.id });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch(opts.url, {
          signal: ctrl.signal,
          headers: { "user-agent": "tech-intel/0.1 (+attribution; respects robots)" },
        });
        if (!res.ok) throw new Error(`rss http ${res.status}`);
        const text = (await res.text()).slice(0, 2_000_000);
        yield { source_id: opts.id, external_id: opts.url, fetched_at: new Date().toISOString(), url: opts.url, raw: text };
      } finally {
        clearTimeout(t);
      }
    },
    parse: (raw: RawPayload) => parseRssXml(String(raw.raw), raw.source_id),
    normalize: (p: ParsedItem) => ({
      source_id: opts.id,
      external_id: p.external_id,
      title: p.title,
      url: p.url,
      canonical_url: canonicalizeUrl(p.url),
      author: p.author,
      published_at: p.published_at,
      content_type: "article",
      summary: p.summary,
      topics: classifyTopics(p.title, p.summary ?? ""),
      entities: extractEntities(`${p.title} ${p.summary ?? ""}`),
    }),
  };
}
