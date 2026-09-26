import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../../infra/src/db.js";
import { clusterBatch } from "../../infra/src/cluster.js";
import { dedupMerge } from "../../infra/src/merge.js";
import { createProvider } from "../../infra/src/ai.js";
import { enqueueEnrichJobs, processDueJobs } from "../../infra/src/jobs.js";
import { rerankStories } from "../../infra/src/rerank.js";
import { persistBatch, recordSourceHealth, upsertSource } from "../../infra/src/store.js";
import { loadRanking, loadSources, type SourceDef } from "../../config/src/index.js";
import { createGithubConnector } from "./connectors/github.js";
import { createHnConnector } from "./connectors/hackernews.js";
import { createProductHuntConnector } from "./connectors/producthunt.js";
import { createRedditConnector } from "./connectors/reddit.js";
import { createXConnector } from "./connectors/x.js";
import { createRssConnector } from "./connectors/rss.js";
import { runOnce } from "./pipeline.js";
import type { SourceConnector } from "./ports.js";

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

const SOURCES_YAML = join(dirname(fileURLToPath(import.meta.url)), "../../config/sources.yaml");
const RANKING_YAML = join(dirname(fileURLToPath(import.meta.url)), "../../config/ranking.yaml");

type Pool = ReturnType<typeof getPool>;

/** Builds one connector per enabled source def. Unknown/disabled -> null (skipped with a log). */
export function buildConnector(def: SourceDef, pool: Pool | null): SourceConnector | null {
  if (!def.enabled) return null;
  switch (def.id) {
    case "hackernews":
      return createHnConnector();
    case "github-trending":
      return createGithubConnector({ cadence_ms: def.cadence_ms });
    case "reddit-machinelearning":
      return createRedditConnector({ id: def.id, subreddit: "MachineLearning", cadence_ms: def.cadence_ms });
    case "producthunt":
      if (!process.env.PRODUCTHUNT_TOKEN) {
        log("warn", "source.disabled_no_key", { id: def.id, need: "PRODUCTHUNT_TOKEN" });
        return null;
      }
      return createProductHuntConnector({ id: def.id, cadence_ms: def.cadence_ms });
    case "x-tech":
      if (!process.env.X_API_BEARER) {
        log("warn", "source.disabled_no_key", { id: def.id, need: "X_API_BEARER" });
        return null;
      }
      return createXConnector({ id: def.id, cadence_ms: def.cadence_ms });
    default:
      if (def.type === "rss" || def.type === "atom") {
        if (!def.url) {
          log("warn", "source.missing_url", { id: def.id });
          return null;
        }
        return createRssConnector({
          id: def.id,
          url: def.url,
          cadence_ms: def.cadence_ms,
          getState: async () => {
            if (!pool) return { etag: null, lastModified: null };
            const r = await pool.query("SELECT etag, last_modified FROM sources WHERE id = $1", [def.id]);
            return { etag: r.rows[0]?.etag ?? null, lastModified: r.rows[0]?.last_modified ?? null };
          },
          setState: async (s) => {
            if (!pool) return;
            await pool.query("UPDATE sources SET etag = $2, last_modified = $3 WHERE id = $1", [
              def.id,
              s.etag,
              s.lastModified,
            ]);
          },
        });
      }
      log("warn", "source.no_connector", { id: def.id, type: def.type });
      return null;
  }
}

async function runSource(connector: SourceConnector, type: string, pool: Pool | null) {
  const id = connector.meta().id;
  const started = Date.now();
  if (pool) {
    try {
      await upsertSource(pool, connector.meta(), type);
    } catch (e) {
      log("warn", "source.upsert_failed", { id, error: (e as Error).message });
    }
  }
  const p = pool;
  const [result] = await runOnce(
    [connector],
    p ? { sink: async (_sourceId, items) => persistBatch(p, items) } : {},
  );
  const latency_ms = Date.now() - started;
  const fatal = result.errors.find((e) => e.startsWith("fetch:") || e.startsWith("persist:"));
  if (pool) {
    try {
      await recordSourceHealth(pool, id, {
        latency_ms,
        fetched_count: result.fetched,
        failed: !!fatal,
        error: fatal,
      });
    } catch (e) {
      log("warn", "health.write_failed", { id, error: (e as Error).message });
    }
  }
  log(fatal ? "error" : "info", "source.run", { id, ...result, latency_ms });
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let aiDisabledLogged = false;

async function runEnrichment(pool: Pool): Promise<void> {
  let provider;
  try {
    provider = createProvider();
  } catch (e) {
    log("error", "ai.bad_config", { error: (e as Error).message });
    return;
  }
  if (!provider) {
    if (!aiDisabledLogged) {
      log("info", "ai.disabled", {});
      aiDisabledLogged = true;
    }
    return;
  }
  try {
    const enqueued = await enqueueEnrichJobs(pool, provider.name, 20);
    const stats = await processDueJobs(pool, provider, 10);
    if (enqueued > 0 || stats.processed > 0 || stats.failed > 0 || stats.dead > 0) {
      log("info", "ai.run", { model: provider.name, enqueued, ...stats });
    }
  } catch (e) {
    log("error", "ai.failed", { error: (e as Error).message });
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const loop = process.argv.includes("--loop");
  const wantEnrich = process.argv.includes("--enrich");
  const defs = loadSources(SOURCES_YAML).filter((d) => d.enabled);
  let pool: Pool | null = null;
  let dbError: string | null = null;
  try {
    pool = getPool();
    await pool.query("SELECT 1");
    log("info", "db.connected", {});
  } catch (e) {
    dbError = (e as Error).message;
  }
  // Fail fast instead of degrading to fetch-only: the silent fallback looked like
  // a successful run (every source "ok") while persisting nothing at all.
  if (!pool) {
    log("error", "db.unavailable", {
      error: dbError,
      hint: "DATABASE_URL missing or unreachable; .env is loaded from the monorepo root (see README)",
    });
    await closePool();
    process.exitCode = 1;
    return;
  }

  const connectors: Array<{ def: SourceDef; connector: SourceConnector }> = [];
  for (const def of defs) {
    const c = buildConnector(def, pool);
    if (c) connectors.push({ def, connector: c });
    else log("info", "source.skipped", { id: def.id });
  }
  if (connectors.length === 0) {
    log("error", "no_sources_enabled", {});
    await closePool();
    process.exitCode = 1;
    return;
  }

  if (!once && !loop) {
    log("info", "usage", { hint: "use --once or --loop" });
  }

  if (once || !loop) {
    const results = [];
    let totalStored = 0;
    for (const { def, connector } of connectors) {
      const r = await runSource(connector, def.type, pool);
      totalStored += r.stored;
      results.push({ type: def.type, ...r });
    }
    if (totalStored > 0) {
      try {
        const ranking = loadRanking(RANKING_YAML);
        const stats = await clusterBatch(pool, ranking.weights);
        log("info", "cluster.run", { ...stats });
        const merged = await dedupMerge(pool, ranking.weights);
        log("info", "merge.run", { ...merged });
        if (wantEnrich) await runEnrichment(pool);
      } catch (e) {
        log("error", "cluster.failed", { error: (e as Error).message });
      }
    }
    // Always rerank, even when nothing new was ingested: decay is time-based, so
    // a run with 0 new items must still push yesterday's stories down.
    try {
      const ranking = loadRanking(RANKING_YAML);
      const rr = await rerankStories(pool, { weights: ranking.weights });
      if (rr.updated > 0) log("info", "rerank.run", { ...rr });
    } catch (e) {
      log("error", "rerank.failed", { error: (e as Error).message });
    }
    console.log(JSON.stringify({ at: new Date().toISOString(), once: true, results }));
  } else {
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const nextRun = new Map(connectors.map(({ def }) => [def.id, 0]));
    // The sweep ticks every 5s; decay only needs to keep up with the feed, so
    // reranking on a 15-minute cadence is plenty and keeps the loop cheap.
    const RERANK_EVERY_MS = 15 * 60 * 1000;
    let lastRerank = 0;
    log("info", "scheduler.start", { sources: connectors.map(({ def }) => def.id) });
    while (!stopped) {
      const now = Date.now();
      let sweepStored = 0;
      for (const { def, connector } of connectors) {
        if (stopped) break;
        if ((nextRun.get(def.id) ?? 0) <= now) {
          sweepStored += (await runSource(connector, def.type, pool)).stored;
          nextRun.set(def.id, Date.now() + def.cadence_ms * (0.85 + Math.random() * 0.3));
        }
      }
      if (sweepStored > 0 && !stopped) {
        try {
          const ranking = loadRanking(RANKING_YAML);
          const stats = await clusterBatch(pool, ranking.weights);
          log("info", "cluster.run", { ...stats });
          const merged = await dedupMerge(pool, ranking.weights);
          log("info", "merge.run", { ...merged });
        } catch (e) {
          log("error", "cluster.failed", { error: (e as Error).message });
        }
      }
      if (!stopped && now - lastRerank >= RERANK_EVERY_MS) {
        lastRerank = now;
        try {
          const ranking = loadRanking(RANKING_YAML);
          const rr = await rerankStories(pool, { weights: ranking.weights });
          if (rr.updated > 0) log("info", "rerank.run", { ...rr });
        } catch (e) {
          log("error", "rerank.failed", { error: (e as Error).message });
        }
      }
      if (!stopped) await runEnrichment(pool);
      if (!stopped) await sleep(5000);
    }
    log("info", "scheduler.stop", {});
  }
  await closePool();
}

await main();
