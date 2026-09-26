import { createHash } from "node:crypto";
import type { Enrichment, EnrichmentProvider } from "./ports.js";

// Async AI enrichment (M5). Sync ingestion/feed never depend on this:
// AI_PROVIDER=none (default) disables everything gracefully.

const PROMPT_TEMPLATE = `Summarize this tech news for busy developers in JSON only.
Title: {title}
Context: {summary}
Return exactly: {"summary": "<=2 sentences>", "why_it_matters": "<=2 sentences>", "key_points": ["...", "...", "..."]}`;

export function promptHash(): string {
  return createHash("sha256").update(PROMPT_TEMPLATE).digest("hex");
}

function renderPrompt(title: string, summary?: string): string {
  return PROMPT_TEMPLATE.replace("{title}", title.slice(0, 300)).replace("{summary}", (summary ?? "").slice(0, 1000));
}

function parseEnrichment(text: string): Enrichment {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(text.slice(start, end + 1)) as Partial<Enrichment>;
      if (typeof o.summary === "string" && o.summary.length > 0) {
        return {
          summary: o.summary.slice(0, 1000),
          why_it_matters: typeof o.why_it_matters === "string" ? o.why_it_matters.slice(0, 1000) : "",
          key_points: Array.isArray(o.key_points) ? o.key_points.filter((k): k is string => typeof k === "string").slice(0, 6) : [],
        };
      }
    } catch {
      // fall through to prose fallback
    }
  }
  return { summary: text.slice(0, 1000), why_it_matters: "", key_points: [] };
}

/** OpenAI-compatible chat provider (OpenAI, OpenRouter, Ollama, vLLM...). No deps, fetch only. */
export class OpenAICompatProvider implements EnrichmentProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.name = `openai-compat/${model}`;
  }

  async summarize(title: string, summary?: string): Promise<Enrichment | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "user-agent": "tech-intel/0.1",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 500,
          messages: [{ role: "user", content: renderPrompt(title, summary) }],
        }).slice(0, 200000),
      });
      if (res.status === 401 || res.status === 403) throw new Error(`enrich auth failed (http ${res.status})`);
      if (res.status === 429) throw new Error("enrich rate-limited");
      if (!res.ok) throw new Error(`enrich http ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) return null;
      return parseEnrichment(text);
    } finally {
      clearTimeout(t);
    }
  }
}

/** Factory from env. Missing key -> null (caller treats as AI disabled). */
export function createProvider(): EnrichmentProvider | null {
  const kind = (process.env.AI_PROVIDER ?? "none").toLowerCase();
  if (kind === "none") return null;
  if (kind === "openai" || kind === "openai-compat") {
    const key = process.env.AI_API_KEY;
    if (!key) return null;
    return new OpenAICompatProvider(
      process.env.AI_API_BASE ?? "https://api.openai.com/v1",
      key,
      process.env.AI_MODEL ?? "gpt-4o-mini",
    );
  }
  throw new Error(`unknown AI_PROVIDER: ${kind}`);
}
