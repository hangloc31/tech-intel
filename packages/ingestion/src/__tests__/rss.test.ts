import { parseRssXml } from "../connectors/rss.js";
import { describe, expect, it } from "vitest";

const SAMPLE = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[OpenAI releases agents SDK]]></title><link>https://example.com/a?utm_source=feed</link><pubDate>Mon, 22 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>New SDK.</p>]]></description></item>
<item><title>Broken</title></item>
</channel></rss>`;

describe("rss", () => {
  it("parses items, skips malformed, strips html", () => {
    const out = parseRssXml(SAMPLE, "test");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("OpenAI");
    expect(out[0].summary).toBe("New SDK.");
  });
});
