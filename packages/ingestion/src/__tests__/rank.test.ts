import { describe, expect, it } from "vitest";
import { score, DEFAULT_WEIGHTS } from "../../../domain/src/rank.js";

/**
 * Regression: `stories.score` is written once at ingest with the story's
 * published_at as "now", so recency never decayed and the Top tab served
 * days-old stories above today's news. rerankStories() re-applies this same
 * formula against the current clock, so it must reproduce ingest-time values
 * exactly when now == published_at, and must fall as time passes.
 */
describe("recency decay", () => {
  const base = {
    source_trust: 0.8,
    source_count: 1,
    engagement: 0,
  };
  const published = "2026-09-26T12:00:00.000Z";
  const t0 = Date.parse(published);

  it("matches the ingest-time score when now == published_at", () => {
    const at = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0);
    // A 1ms-later clock shifts recency imperceptibly (not bit-identical).
    const one = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0 + 1);
    expect(one).toBeCloseTo(at, 6);
    // recency dominates: 0.5 * 1 + 0.25 * 0.8 + 0.15 * cross(1)
    expect(at).toBeCloseTo(0.5 + 0.2 + 0.15 * (Math.log1p(1) / Math.log1p(10)), 6);
  });

  it("decays monotonically as time passes", () => {
    const hours = [0, 6, 12, 24, 48, 72, 168];
    const scores = hours.map((h) => score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0 + h * 36e5));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("halves recency every half-life (24h default), so 24h removes 0.25", () => {
    const now = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0);
    const day = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0 + 24 * 36e5);
    const twoDays = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0 + 48 * 36e5);
    // recency halves each half-life and recency carries weight 0.5
    expect(now - day).toBeCloseTo(0.25, 6);
    expect(day - twoDays).toBeCloseTo(0.125, 6);
  });

  it("floors at the non-recency components instead of going negative", () => {
    const ancient = score({ ...base, published_at: published }, DEFAULT_WEIGHTS, t0 + 365 * 24 * 36e5);
    expect(ancient).toBeGreaterThan(0);
    expect(ancient).toBeCloseTo(0.25 * base.source_trust + 0.15 * (Math.log1p(1) / Math.log1p(10)), 6);
  });

  it("lets a fresh story outrank a stale one at the same trust", () => {
    const fresh = score({ ...base, published_at: "2026-09-26T12:00:00.000Z" }, DEFAULT_WEIGHTS, t0 + 3 * 36e5);
    const stale = score({ ...base, published_at: "2026-09-23T12:00:00.000Z" }, DEFAULT_WEIGHTS, t0 + 3 * 36e5);
    expect(fresh).toBeGreaterThan(stale);
  });
});
