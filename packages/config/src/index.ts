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
