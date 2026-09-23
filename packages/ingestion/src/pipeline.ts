import type { SourceConnector } from "./ports.js";
import { createRssConnector } from "./connectors/rss.js";
import { createHnConnector } from "./connectors/hackernews.js";

export interface RunResult {
  source_id: string;
  fetched: number;
  parsed: number;
  errors: string[];
}

/** Runs each connector once with per-source isolation: one source failing never stops others. */
export async function runOnce(connectors: SourceConnector[]): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const c of connectors) {
    const r: RunResult = { source_id: c.meta().id, fetched: 0, parsed: 0, errors: [] };
    try {
      const ctx = { signal: AbortSignal.timeout(30000), log: () => {} };
      for await (const raw of c.fetch(ctx)) {
        r.fetched++;
        try {
          r.parsed += c.parse(raw).length;
        } catch (e) {
          r.errors.push(`parse: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      r.errors.push(`fetch: ${(e as Error).message}`);
    }
    results.push(r);
  }
  return results;
}

export function defaultConnectors(): SourceConnector[] {
  return [
    createHnConnector(),
    createRssConnector({ id: "techcrunch", url: "https://techcrunch.com/feed/" }),
    createRssConnector({ id: "openai-blog", url: "https://openai.com/news/rss.xml" }),
  ];
}
