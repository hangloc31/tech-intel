import type { RankInput } from "./types.js";

export interface RankWeights {
  recency: number;
  trust: number;
  cross_source: number;
  engagement: number;
  half_life_hours: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  recency: 0.5,
  trust: 0.25,
  cross_source: 0.15,
  engagement: 0.1,
  half_life_hours: 24,
};

export function score(input: RankInput, w: RankWeights = DEFAULT_WEIGHTS, nowMs = Date.now()): number {
  const ageHrs = Math.max(0, (nowMs - Date.parse(input.published_at)) / 36e5);
  const recency = Math.pow(0.5, ageHrs / w.half_life_hours);
  const trust = Math.min(1, Math.max(0, input.source_trust));
  const cross = Math.log1p(Math.max(0, input.source_count)) / Math.log1p(10); // 0..~1
  const eng = Math.min(1, Math.max(0, input.engagement));
  return w.recency * recency + w.trust * trust + w.cross_source * Math.min(1, cross) + w.engagement * eng;
}
