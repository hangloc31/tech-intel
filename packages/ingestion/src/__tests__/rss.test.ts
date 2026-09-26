import { afterEach, describe, expect, it, vi } from "vitest";
import { createRssConnector, extractImage, extractInlineImage, fetchRssBody, parseRssXml } from "../connectors/rss.js";

const SAMPLE = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[OpenAI releases agents SDK]]></title><link>https://example.com/a?utm_source=feed</link><pubDate>Mon, 22 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>New SDK.</p>]]></description></item>
<item><title>Broken</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom post</title><link href="https://example.com/atom-1"/><published>2026-09-22T10:00:00Z</published><author><name>jane</name></author></entry>
<entry><title>No link here</title></entry>
<entry><title>Bad date</title><link href="https://example.com/bad-date"/><published>not-a-date</published></entry>
</feed>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rss", () => {
  it("parses items, skips malformed, strips html", () => {
    const out = parseRssXml(SAMPLE, "test");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("OpenAI");
    expect(out[0].summary).toBe("New SDK.");
  });

  it("parses atom entries, skips linkless, falls back on bad dates", () => {
    const out = parseRssXml(ATOM, "test");
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://example.com/atom-1");
    // bad date -> now, never throws, always valid ISO
    expect(Number.isNaN(Date.parse(out[1].published_at))).toBe(false);
  });

  it("accepts single-quoted href (e.g. tbray.org atom)", () => {
    const xml = `<feed><entry><title>T</title><link href='https://example.com/sq'/></entry></feed>`;
    const out = parseRssXml(xml, "test");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://example.com/sq");
  });

  it("extracts enclosure/media images, rejects non-images", () => {
    expect(extractImage(`<item><enclosure url="https://example.com/a.jpg" type="image/jpeg"/></item>`)).toBe(
      "https://example.com/a.jpg",
    );
    expect(extractImage(`<item><media:thumbnail url='https://example.com/b.png'/></item>`)).toBe("https://example.com/b.png");
    expect(extractImage(`<item><enclosure url="https://example.com/a.mp3" type="audio/mpeg"/></item>`)).toBeUndefined();
    expect(extractImage(`<item><enclosure url="ftp://example.com/a.jpg"/></item>`)).toBeUndefined();
    expect(extractImage(`<item><title>no image</title></item>`)).toBeUndefined();
  });

  it("parse attaches image_url", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://example.com/x</link><enclosure url="https://example.com/x.webp" type="image/webp"/></item></channel></rss>`;
    const out = parseRssXml(xml, "test");
    expect(out[0].image_url).toBe("https://example.com/x.webp");
  });

  it("falls back to inline description images, skips trackers", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://example.com/y</link><description><![CDATA[<p>Hi</p><img src="https://cdn.example.com/photo.jpg?w=800"/><img src="https://example.com/pixel.gif" width="1"/>]]></description></item></channel></rss>`;
    const out = parseRssXml(xml, "test");
    expect(out[0].image_url).toBe("https://cdn.example.com/photo.jpg?w=800");
    expect(
      extractInlineImage(`<img src="data:image/gif;base64,AAA"/>`),
    ).toBeUndefined();
  });

  it("sends conditional headers and returns not_modified on 304", async () => {
    const seen: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) seen[k] = v;
        return new Response(null, { status: 304 });
      }),
    );
    const out = await fetchRssBody(
      "https://example.com/feed",
      { etag: '"abc"', lastModified: "Mon, 22 Sep 2026 10:00:00 GMT" },
      AbortSignal.timeout(5000),
    );
    expect(out).toEqual({ status: "not_modified" });
    expect(seen["if-none-match"]).toBe('"abc"');
    expect(seen["if-modified-since"]).toBe("Mon, 22 Sep 2026 10:00:00 GMT");
  });

  it("follows up to 3 redirects with SSRF check, then throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://example.com/a") return new Response(null, { status: 302, headers: { location: "/b" } });
        if (url === "https://example.com/b") return new Response(null, { status: 302, headers: { location: "/c" } });
        if (url === "https://example.com/c") return new Response(null, { status: 302, headers: { location: "/d" } });
        return new Response(null, { status: 302, headers: { location: "/e" } });
      }),
    );
    await expect(
      fetchRssBody("https://example.com/a", { etag: null, lastModified: null }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/too many redirects/);
  });

  it("blocks private redirect targets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } })),
    );
    await expect(
      fetchRssBody("https://example.com/a", { etag: null, lastModified: null }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/blocked/);
  });

  it("connector yields nothing on 304 and persists fresh etag", async () => {
    let saved: { etag: string | null; lastModified: string | null } | null = null;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));
    const c304 = createRssConnector({
      id: "t",
      url: "https://example.com/feed",
      getState: async () => ({ etag: '"x"', lastModified: null }),
      setState: async (s) => {
        saved = s;
      },
    });
    const ctx = { signal: AbortSignal.timeout(5000), log: () => {} };
    let n = 0;
    for await (const _ of c304.fetch(ctx)) n++;
    expect(n).toBe(0);
    expect(saved).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(SAMPLE, { status: 200, headers: { etag: '"v2"' } })),
    );
    const c200 = createRssConnector({
      id: "t",
      url: "https://example.com/feed",
      getState: async () => ({ etag: null, lastModified: null }),
      setState: async (s) => {
        saved = s;
      },
    });
    for await (const _ of c200.fetch(ctx)) n++;
    expect(n).toBe(1);
    expect(saved).toEqual({ etag: '"v2"', lastModified: null });
  });
});
