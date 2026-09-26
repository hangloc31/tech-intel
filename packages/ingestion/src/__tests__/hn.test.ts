import { describe, expect, it } from "vitest";
import { createHnConnector, isUsableHnItem } from "../connectors/hackernews.js";

describe("hackernews", () => {
  it("skips deleted/dead/null/titleless items", () => {
    expect(isUsableHnItem(null)).toBe(false);
    expect(isUsableHnItem(undefined)).toBe(false);
    expect(isUsableHnItem({ id: 1 } as never)).toBe(false);
    expect(isUsableHnItem({ id: 1, title: "x", deleted: true })).toBe(false);
    expect(isUsableHnItem({ id: 1, title: "x", dead: true })).toBe(false);
    expect(isUsableHnItem({ id: 1, title: "Hello" })).toBe(true);
  });

  it("parse falls back to HN discussion url and valid date", () => {
    const c = createHnConnector();
    const out = c.parse({
      source_id: "hackernews",
      external_id: "123",
      fetched_at: new Date().toISOString(),
      url: "https://news.ycombinator.com/item?id=123",
      raw: { id: 123, title: "Ask HN: testing?", by: "pg", time: 1758618000 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("news.ycombinator.com/item?id=123");
    expect(out[0].author).toBe("pg");
    expect(Number.isNaN(Date.parse(out[0].published_at))).toBe(false);
  });

  it("normalize maps to discussion with canonical url", () => {
    const c = createHnConnector();
    const n = c.normalize({
      external_id: "1",
      title: "Launch HN: demo",
      url: "https://example.com/x?utm_source=feed",
      published_at: new Date().toISOString(),
      raw: {},
    });
    expect(n.content_type).toBe("discussion");
    expect(n.canonical_url).not.toContain("utm_source");
  });
});
