import { describe, expect, it } from "vitest";
import {
  assertSafeRepo,
  createGithubConnector,
  isRateLimited,
  parseGithubRelease,
} from "../connectors/github.js";

const RELEASE = {
  id: 178901234,
  tag_name: "v1.4.0",
  name: "Faster router + streaming",
  body: "## Highlights\n- Faster router\n```js\ncode()\n```\n<p>ship it</p>",
  html_url: "https://github.com/vercel/next.js/releases/tag/v1.4.0",
  author: { login: "vercel" },
  created_at: "2026-09-20T10:00:00Z",
  published_at: "2026-09-20T12:00:00Z",
  draft: false,
  prerelease: false,
};

describe("github connector", () => {
  it("maps a normal release to ParsedItem", () => {
    const out = parseGithubRelease("vercel/next.js", RELEASE);
    expect(out).not.toBeNull();
    expect(out!.external_id).toBe("vercel/next.js@178901234");
    expect(out!.title).toContain("vercel/next.js");
    expect(out!.title).toContain("v1.4.0");
    expect(out!.url).toContain("github.com/vercel/next.js");
    expect(out!.author).toBe("vercel");
    expect(out!.summary).not.toMatch(/<p>|```/);
  });

  it("skips drafts, keeps prereleases", () => {
    expect(parseGithubRelease("a/b", { ...RELEASE, draft: true })).toBeNull();
    const pre = parseGithubRelease("a/b", {
      ...RELEASE,
      id: 2,
      prerelease: true,
      html_url: "https://github.com/a/b/releases/tag/v2-beta",
    });
    expect(pre).not.toBeNull();
  });

  it("skips malformed releases (no id, no tag/name)", () => {
    expect(parseGithubRelease("a/b", {} as never)).toBeNull();
    expect(parseGithubRelease("a/b", { id: 1 } as never)).toBeNull();
  });

  it("falls back when html_url/published_at missing", () => {
    const out = parseGithubRelease("a/b", { id: 9, tag_name: "v9" });
    expect(out!.url).toBe("https://github.com/a/b/releases/tag/v9");
    expect(Number.isNaN(Date.parse(out!.published_at))).toBe(false);
  });

  it("validates repo names (SSRF/path guard)", () => {
    expect(() => assertSafeRepo("vercel/next.js")).not.toThrow();
    for (const bad of ["", "../etc", "a", "a/b/c", "a b/c", "https://evil.com/x"]) {
      expect(() => assertSafeRepo(bad)).toThrow();
    }
  });

  it("detects rate-limit responses", () => {
    expect(isRateLimited(403, "0")).toBe(true);
    expect(isRateLimited(429, null)).toBe(true);
    expect(isRateLimited(403, "59")).toBe(false);
    expect(isRateLimited(404, null)).toBe(false);
  });

  it("parse() unwraps fetch RawPayload, normalize() maps to release", () => {
    const c = createGithubConnector({ repos: ["vercel/next.js"] });
    expect(c.meta().id).toBe("github-trending");
    const parsed = c.parse({
      source_id: "github-trending",
      external_id: "vercel/next.js@1",
      fetched_at: new Date().toISOString(),
      url: RELEASE.html_url,
      raw: { repo: "vercel/next.js", release: RELEASE },
    });
    expect(parsed).toHaveLength(1);
    const n = c.normalize(parsed[0]);
    expect(n.content_type).toBe("release");
    expect(n.canonical_url).toContain("github.com");
    expect(n.external_id).toBe("vercel/next.js@178901234");
  });
});
