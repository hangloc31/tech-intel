import { describe, expect, it } from "vitest";
import { canonicalizeUrl, classifyPair, contentHash, simHashDistance, simHash } from "../dedup.js";
import { score } from "../rank.js";
import { extractEntities, classifyTopics } from "../entities.js";
import type { NormalizedItem } from "../types.js";

const base: NormalizedItem = {
  source_id: "techcrunch",
  external_id: "1",
  title: "OpenAI releases GPT-5 with agents",
  url: "https://techcrunch.com/2026/09/23/openai-gpt-5/?utm_source=feed",
  canonical_url: "https://techcrunch.com/2026/09/23/openai-gpt-5/",
  published_at: "2026-09-23T00:00:00.000Z",
  content_type: "article",
  topics: ["AI"],
  entities: ["OpenAI", "GPT"],
};

describe("dedup", () => {
  it("canonicalizes tracking params and trailing slash", () => {
    expect(canonicalizeUrl(base.url)).toBe("https://techcrunch.com/2026/09/23/openai-gpt-5");
  });
  it("exact duplicate on same normalized title+url", () => {
    const b = { ...base, source_id: "verge", external_id: "2", url: base.url + "#frag" };
    expect(classifyPair(base, b)).toBe("exact");
  });
  it("near duplicate on reworded title", () => {
    const long: NormalizedItem = {
      ...base,
      title: "OpenAI releases GPT-5 with autonomous agents for software engineering teams",
    };
    const reword: NormalizedItem = {
      ...base,
      title: "OpenAI releases GPT-5 with autonomous agents for engineering teams",
      canonical_url: "https://x.com/a",
    };
    const d = simHashDistance(simHash(long.title), simHash(reword.title));
    expect(d).toBeLessThanOrEqual(12);
    expect(classifyPair(long, reword)).toMatch(/near_duplicate|same_story/);
  });
  it("contentHash stable", () => {
    expect(contentHash(base)).toBe(contentHash({ ...base }));
  });
});

describe("rank", () => {
  it(" fresher scores higher; trust/cross-source increase score", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const fresh = score({ published_at: "2026-09-23T11:00:00.000Z", source_trust: 0.8, source_count: 1, engagement: 0.2 }, undefined, now);
    const old = score({ published_at: "2026-09-20T11:00:00.000Z", source_trust: 0.8, source_count: 1, engagement: 0.2 }, undefined, now);
    expect(fresh).toBeGreaterThan(old);
    const multi = score({ published_at: "2026-09-23T11:00:00.000Z", source_trust: 0.8, source_count: 8, engagement: 0.2 }, undefined, now);
    expect(multi).toBeGreaterThan(fresh);
  });
});

describe("entities/topics", () => {
  it("extracts known entities", () => {
    expect(extractEntities("OpenAI GPT beats Claude on Rust benchmarks")).toContain("OpenAI");
  });
  it("classifies AI topic", () => {
    expect(classifyTopics("New LLM agents benchmark")).toContain("AI");
  });
});
