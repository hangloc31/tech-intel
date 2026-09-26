import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TopicNode {
  name: string;
  children: string[];
}

let cache: TopicNode[] | null = null;

/** Reads packages/config/topics.yaml (server-only). Falls back to []. */
export function loadTopics(): TopicNode[] {
  if (cache) return cache;
  try {
    const candidates = [
      join(process.cwd(), "packages", "config", "topics.yaml"), // launched from repo root
      join(process.cwd(), "..", "packages", "config", "topics.yaml"), // launched from apps/web
    ];
    const p = candidates.find((c) => existsSync(c));
    if (!p) return [];
    cache = parseTopicsYaml(readFileSync(p, "utf8"));
    return cache;
  } catch {
    return [];
  }
}

/** Minimal parser: top-level `Name:` keys + inline `children: [a, b]`. */
export function parseTopicsYaml(yaml: string): TopicNode[] {
  const out: TopicNode[] = [];
  let cur: TopicNode | null = null;
  for (const line of yaml.split("\n")) {
    const top = line.match(/^([A-Za-z][\w ]*):\s*(\{\})?\s*$/);
    if (top && !line.startsWith(" ") && !line.startsWith("\t")) {
      cur = { name: top[1].trim(), children: [] };
      out.push(cur);
      continue;
    }
    const kids = line.match(/^\s+children:\s*\[(.*)\]\s*$/);
    if (kids && cur) {
      cur.children = kids[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}
