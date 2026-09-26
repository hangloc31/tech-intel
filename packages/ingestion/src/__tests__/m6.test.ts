import { describe, expect, it } from "vitest";
import { createProductHuntConnector, parseProductHuntPost } from "../connectors/producthunt.js";
import { createRedditConnector, parseRedditPost } from "../connectors/reddit.js";
import { createXConnector, parseXPost } from "../connectors/x.js";

function ctx() {
  return { signal: AbortSignal.timeout(5000), log: () => {} };
}

async function drain(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("m6 provider abstractions", () => {
  it("reddit parses posts, skips stickied/malformed", () => {
    const p = parseRedditPost("MachineLearning", {
      id: "abc123",
      title: "New paper on agents",
      url: "https://arxiv.org/abs/2601.1",
      author: "ml_fan",
      created_utc: 1758618000,
      selftext: "thoughts?",
    });
    expect(p?.external_id).toBe("reddit:abc123");
    expect(p?.author).toBe("ml_fan");
    expect(parseRedditPost("s", { id: "x", title: "pinned", stickied: true })).toBeNull();
    expect(parseRedditPost("s", { id: "x" } as never)).toBeNull();
    const c = createRedditConnector({});
    const n = c.normalize(p!);
    expect(n.content_type).toBe("discussion");
  });

  it("producthunt refuses without token, parses fixture", async () => {
    const prev = process.env.PRODUCTHUNT_TOKEN;
    delete process.env.PRODUCTHUNT_TOKEN;
    try {
      const c = createProductHuntConnector({});
      await expect(drain(c.fetch(ctx()))).rejects.toThrow(/PRODUCTHUNT_TOKEN/);
    } finally {
      if (prev !== undefined) process.env.PRODUCTHUNT_TOKEN = prev;
    }
    const p = parseProductHuntPost({ id: 9, name: "DevTool", tagline: "ship faster", createdAt: "2026-09-20T10:00:00Z" });
    expect(p?.external_id).toBe("ph:9");
    expect(p?.title).toContain("DevTool");
  });

  it("x refuses without bearer, parses fixture", async () => {
    const prev = process.env.X_API_BEARER;
    delete process.env.X_API_BEARER;
    try {
      const c = createXConnector({});
      await expect(drain(c.fetch(ctx()))).rejects.toThrow(/X_API_BEARER/);
    } finally {
      if (prev !== undefined) process.env.X_API_BEARER = prev;
    }
    const p = parseXPost({ id: "123", text: "shipping today", author: "dev", created_at: "2026-09-20T10:00:00Z" });
    expect(p?.external_id).toBe("x:123");
    expect(createXConnector({}).normalize(p!).content_type).toBe("post");
  });
});
