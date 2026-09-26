import type { FetchCtx, ParsedItem, RawPayload, SourceConnector } from "../ports.js";
import { canonicalizeUrl, classifyTopics, extractEntities } from "../../../domain/src/index.js";

const GITHUB_API_BASE = process.env.GITHUB_API_BASE ?? "https://api.github.com";

/** Curated release watchlist. Deterministic, quota-friendly (1 req/repo/run).
 *  Trending scrape has no official API and is noisy — deferred to M6. */
export const DEFAULT_GITHUB_REPOS = [
  "vercel/next.js",
  "facebook/react",
  "microsoft/vscode",
  "microsoft/typescript",
  "rust-lang/rust",
  "golang/go",
  "kubernetes/kubernetes",
  "langchain-ai/langchain",
  "openai/openai-python",
  "oven-sh/bun",
  "facebook/react-native",
  "denoland/deno",
];

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function assertSafeRepo(repo: string): void {
  if (!REPO_RE.test(repo)) throw new Error(`blocked repo: ${repo}`);
  const [owner, name] = repo.split("/");
  if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") {
    throw new Error(`blocked repo: ${repo}`);
  }
}

export function assertSafeApiUrl(url: string): void {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`blocked protocol: ${u.protocol}`);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("blocked host");
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error("blocked private IP literal");
  if (["169.254.169.254", "0.0.0.0"].includes(host)) throw new Error("blocked metadata IP");
}

export interface GithubReleaseRaw {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  author?: { login?: string };
  created_at?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

export function isRateLimited(status: number, remaining: string | null): boolean {
  return status === 429 || (status === 403 && remaining === "0");
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*`_\-[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure mapper: release JSON -> ParsedItem. Returns null for draft/unusable. */
export function parseGithubRelease(repo: string, r: GithubReleaseRaw): ParsedItem | null {
  if (!r || typeof r.id !== "number") return null;
  if (r.draft === true) return null;
  const tag = (r.tag_name ?? "").trim();
  const name = (r.name ?? "").trim();
  if (!tag && !name) return null;
  const title = `${repo} ${tag}${name && name !== tag ? `: ${name}` : ""}`.slice(0, 300);
  const url = r.html_url ?? `https://github.com/${repo}/releases/tag/${tag || r.id}`;
  const published = r.published_at ?? r.created_at ?? new Date().toISOString();
  const summary = r.body ? stripMarkdown(r.body).slice(0, 500) || undefined : undefined;
  return {
    external_id: `${repo}@${r.id}`,
    title,
    url,
    author: r.author?.login,
    published_at: new Date(published).toISOString(),
    summary,
    raw: { repo, release: r },
  };
}

async function fetchReleases(
  repo: string,
  perRepoLimit: number,
  signal: AbortSignal,
): Promise<GithubReleaseRaw[]> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/releases?per_page=${perRepoLimit}`;
  assertSafeApiUrl(url);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "tech-intel/0.1 (+attribution; respects robots)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { signal, headers });
  if (res.status === 404) return []; // renamed/deleted/private -> skip quietly
  if (isRateLimited(res.status, res.headers.get("x-ratelimit-remaining"))) {
    const reset = res.headers.get("x-ratelimit-reset") ?? "unknown";
    throw new Error(`github rate-limited (reset=${reset})`);
  }
  if (!res.ok) throw new Error(`github http ${res.status} for ${repo}`);
  const text = (await res.text()).slice(0, 2_000_000);
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data as GithubReleaseRaw[];
}

export function createGithubConnector(
  opts: { id?: string; repos?: string[]; cadence_ms?: number; perRepoLimit?: number } = {},
): SourceConnector {
  const id = opts.id ?? "github-trending";
  const repos = opts.repos ?? DEFAULT_GITHUB_REPOS;
  const perRepoLimit = Math.min(20, Math.max(1, opts.perRepoLimit ?? 5));
  return {
    meta: () => ({ id, type: "api", cadence_ms: opts.cadence_ms ?? 600000, needs_auth: false }),
    async *fetch(ctx: FetchCtx): AsyncIterable<RawPayload> {
      ctx.log("github.fetch.releases", { id, repos: repos.length });
      for (const repo of repos) {
        assertSafeRepo(repo);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        // Honor caller abort (e.g. pipeline timeout).
        const onAbort = () => ctrl.abort();
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        try {
          let releases: GithubReleaseRaw[];
          try {
            releases = await fetchReleases(repo, perRepoLimit, ctrl.signal);
          } catch (e) {
            const msg = (e as Error).message;
            // Rate-limit aborts the whole source so scheduler can back off;
            // per-repo failures are skipped to protect the other repos.
            if (msg.includes("rate-limited")) throw e;
            ctx.log("github.fetch.repo_error", { repo, error: msg });
            continue;
          }
          for (const r of releases) {
            if (r?.draft === true) continue;
            if (typeof r?.id !== "number") continue;
            yield {
              source_id: id,
              external_id: `${repo}@${r.id}`,
              fetched_at: new Date().toISOString(),
              url: r.html_url ?? `https://github.com/${repo}/releases`,
              raw: { repo, release: r },
            };
          }
        } finally {
          clearTimeout(t);
          ctx.signal.removeEventListener("abort", onAbort);
        }
      }
    },
    parse: (raw: RawPayload) => {
      const { repo, release } = raw.raw as { repo: string; release: GithubReleaseRaw };
      const out = parseGithubRelease(repo, release);
      return out ? [out] : [];
    },
    normalize: (p: ParsedItem) => ({
      source_id: id,
      external_id: p.external_id,
      title: p.title,
      url: p.url,
      canonical_url: canonicalizeUrl(p.url),
      author: p.author,
      published_at: p.published_at,
      content_type: "release",
      summary: p.summary,
      topics: classifyTopics(p.title, p.summary ?? ""),
      entities: extractEntities(`${p.title} ${p.summary ?? ""}`),
    }),
  };
}
