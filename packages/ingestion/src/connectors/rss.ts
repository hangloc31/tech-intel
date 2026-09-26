import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

/** First usable inline <img> from item HTML (description/content), enclosure fallback first. */
export function extractInlineImage(html: string): string | undefined {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/\bwidth\s*=\s*["']?1\b/i.test(tag)) continue; // tracking pixel
    if (/pixel|beacon|track|spacer/i.test(tag)) continue;
    const m = tag.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const u = m?.[1] ?? m?.[2];
    if (!u || /^(data|blob|javascript):/i.test(u)) continue;
    try {
      const parsed = new URL(u, "https://example.com");
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (parsed.hostname === "example.com") continue; // relative -> host unknown
      const imageish =
        /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i.test(parsed.pathname) ||
        /[?&](w|width|format|fm|q|quality)=/i.test(u);
      if (imageish) return u.slice(0, 500);
    } catch {
      // ignore
    }
  }
  return undefined;
}
export function extractImage(block: string): string | undefined {
  const cands: Array<string | undefined> = [
    block.match(/<enclosure[^>]*url=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean),
    block.match(/<media:(?:thumbnail|content)[^>]*url=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean),
    block.match(/<(?:itunes:image|image|media:image)[^>]*(?:href|url)=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean),
  ];
  for (const u of cands) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(parsed.pathname)) {
        return u.slice(0, 500);
      }
    } catch {
      // ignore malformed urls
    }
  }
  return undefined;
}

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
    const href = b.match(/<link[^>]*href=(?:"([^"]+)"|'([^']+)')/);
    if (href) link = href[1] ?? href[2] ?? link;
    if (!title || !link) continue;
    const pub = pick("pubDate") || pick("published") || pick("updated");
    const ms = pub ? Date.parse(pub) : NaN;
    const descHtml = pick("description") || pick("content:encoded") || pick("summary") || "";
    items.push({
      external_id: link,
      title,
      url: link,
      author: pick("author") || pick("dc:creator") || undefined,
      published_at: Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString(),
      summary: descHtml.replace(/<[^>]+>/g, "").slice(0, 1500) || undefined,
      image_url: extractImage(b) ?? extractInlineImage(descHtml),
      raw: b.slice(0, 2000),
    });
  }
  return items;
}

export interface RssFetchState {
  etag: string | null;
  lastModified: string | null;
}

export type RssFetchResult =
  | { status: "fresh"; text: string; etag: string | null; lastModified: string | null }
  | { status: "not_modified" };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Pure-ish fetch helper: manual redirects (cap 3, SSRF-checked per hop),
 *  conditional GET on the origin URL, 10s timeout, 2MB body cap. */
export async function fetchRssBody(
  url: string,
  state: RssFetchState,
  signal: AbortSignal,
): Promise<RssFetchResult> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    assertSafeUrl(current);
    const headers: Record<string, string> = {
      "user-agent": "tech-intel/0.1 (+attribution; respects robots)",
    };
    if (hop === 0) {
      if (state.etag) headers["if-none-match"] = state.etag;
      if (state.lastModified) headers["if-modified-since"] = state.lastModified;
    }
    const res = await fetch(current, { signal, headers, redirect: "manual" });
    if (REDIRECTS.has(res.status)) {
      try {
        await res.arrayBuffer();
      } catch {
        // ignore drain errors
      }
      const loc = res.headers.get("location");
      if (!loc) throw new Error("rss redirect without location");
      if (hop === 3) throw new Error("rss too many redirects");
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 304) {
      try {
        await res.arrayBuffer();
      } catch {
        // ignore
      }
      return { status: "not_modified" };
    }
    if (!res.ok) throw new Error(`rss http ${res.status}`);
    const text = (await res.text()).slice(0, 2_000_000);
    return {
      status: "fresh",
      text,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  }
  throw new Error("rss too many redirects");
}

export interface RssConnectorOpts {
  id: string;
  url: string;
  cadence_ms?: number;
  getState?: () => Promise<RssFetchState>;
  setState?: (s: RssFetchState) => Promise<void>;
}

export function createRssConnector(opts: RssConnectorOpts): SourceConnector {
  return {
    meta: () => ({ id: opts.id, type: "rss", cadence_ms: opts.cadence_ms ?? 600000, needs_auth: false }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      assertSafeUrl(opts.url);
      ctx.log("rss.fetch", { id: opts.id });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const onAbort = () => ctrl.abort();
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const state = (await opts.getState?.()) ?? { etag: null, lastModified: null };
        const out = await fetchRssBody(opts.url, state, ctrl.signal);
        if (out.status === "not_modified") {
          ctx.log("rss.not_modified", { id: opts.id });
          return;
        }
        await opts.setState?.({ etag: out.etag, lastModified: out.lastModified });
        yield {
          source_id: opts.id,
          external_id: opts.url,
          fetched_at: new Date().toISOString(),
          url: opts.url,
          raw: out.text,
        };
      } finally {
        clearTimeout(t);
        ctx.signal.removeEventListener("abort", onAbort);
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
      image_url: p.image_url,
      topics: classifyTopics(p.title, p.summary ?? ""),
      entities: extractEntities(`${p.title} ${p.summary ?? ""}`),
    }),
  };
}
