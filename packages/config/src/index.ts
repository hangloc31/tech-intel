import { readFileSync } from "node:fs";

export type SourceType = "rss" | "atom" | "api" | "web";

export interface SourceDef {
  id: string;
  type: SourceType;
  enabled: boolean;
  url?: string;
  cadence_ms: number;
  trust: number;
  adaptive?: boolean;
}

export function parseSourcesYaml(yaml: string): SourceDef[] {
  // Minimal dependency-free YAML subset parser for our known shape.
  const sources: SourceDef[] = [];
  const lines = yaml.split("\n");
  let cur: Record<string, string | number | boolean> | null = null;
  const push = () => {
    if (cur && cur["id"]) {
      sources.push({
        id: String(cur["id"]),
        type: (cur["type"] as SourceType) ?? "rss",
        enabled: cur["enabled"] === true || cur["enabled"] === "true",
        url: cur["url"] ? String(cur["url"]) : undefined,
        cadence_ms: Number(cur["cadence_ms"] ?? 600000),
        trust: Number(cur["trust"] ?? 0.5),
      });
    }
    cur = null;
  };
  for (const line of lines) {
    if (/^\s*-\s+id:/.test(line)) {
      push();
      cur = {};
      cur["id"] = line.split("id:")[1].trim();
    } else if (cur && /^\s+\w+:/.test(line)) {
      const [k, ...rest] = line.trim().split(":");
      const v = rest.join(":").trim();
      if (v === "true") cur[k] = true;
      else if (v === "false") cur[k] = false;
      else if (/^\d+$/.test(v)) cur[k] = Number(v);
      else if (/^\d*\.\d+$/.test(v)) cur[k] = Number(v);
      else cur[k] = v;
    }
  }
  push();
  return sources;
}

export function loadSources(yamlPath: string): SourceDef[] {
  return parseSourcesYaml(readFileSync(yamlPath, "utf8"));
}

export function getEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export interface RankingWeights {
  recency: number;
  trust: number;
  cross_source: number;
  engagement: number;
  half_life_hours: number;
}

export interface RankingConfig {
  weights: RankingWeights;
  trending_half_life_hours: number;
  trending_window_hours: number;
}

export const DEFAULT_RANKING: RankingConfig = {
  weights: { recency: 0.5, trust: 0.25, cross_source: 0.15, engagement: 0.1, half_life_hours: 24 },
  trending_half_life_hours: 6,
  trending_window_hours: 48,
};

/** Minimal parser for our known ranking.yaml shape; unknown keys ignored. */
export function parseRankingYaml(yaml: string): RankingConfig {
  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const out: RankingConfig = JSON.parse(JSON.stringify(DEFAULT_RANKING));
  const WEIGHT_KEYS = ["recency", "trust", "cross_source", "engagement", "half_life_hours"] as const;
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s{2}(\w+):\s*([0-9.]+)\s*$/);
    if (m && (WEIGHT_KEYS as readonly string[]).includes(m[1])) {
      const k = m[1] as (typeof WEIGHT_KEYS)[number];
      out.weights[k] = num(m[2], out.weights[k]);
      continue;
    }
    const t = line.match(/^(\w+):\s*([0-9.]+)\s*$/);
    if (t && (t[1] === "trending_half_life_hours" || t[1] === "trending_window_hours")) {
      out[t[1]] = num(t[2], out[t[1]]);
    }
  }
  return out;
}

export function loadRanking(yamlPath: string): RankingConfig {
  try {
    return parseRankingYaml(readFileSync(yamlPath, "utf8"));
  } catch {
    return DEFAULT_RANKING;
  }
}
