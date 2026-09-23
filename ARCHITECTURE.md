# ARCHITECTURE.md — Tech Intel

## 1. System overview (monolith-modular)

```text
Sources (RSS/Atom/API/HN/GitHub/X/Reddit)
  │  per-source schedule, rate-limit, retry/backoff, timeout
  ▼
Fetch Worker (packages/ingestion) — SSRF allowlist, robots respect, conditional GET
  ▼
Parse → Normalize (pure, packages/domain) → RawContent (immutable) + Item
  ▼
Jobs table (Postgres) — async: enrich → embed → dedup → cluster → rank
  ▼
Serve — Next.js Route Handlers (read API) + SSR/ISR web
```

Sync: fetch→parse→normalize→store. Async: everything AI/similarity/ranking.
If AI provider down: ingestion + feed still work; enrichment retries later.

## 2. Components

* `packages/ingestion/ports`: `SourceConnector { fetch, parse, normalize, meta }`.
  Each connector handles pagination, malformed data, deleted content, quota. Enable/disable via YAML.
* `packages/domain`: `normalize`, `dedup` (exact sha256 → near-dup SimHash), `cluster`
  (72h window + entity overlap), `rank` (pure scorer, weights in config), `topics` taxonomy.
* `packages/infra/db`: Postgres 16 + pgvector + FTS. Tables: `sources, items, raw_contents,
  authors, topics, entities, stories, story_items, embeddings, enrichments, jobs, jobs_failed`.
  Raw immutable; normalized separate; AI output separate with `model_name/version + raw_id`.
* `packages/infra/queue`: Postgres `jobs` table (no Redis in MVP). Idempotent keys
  `source_id+external_id+content_hash`. Worker polls per queue with backoff.
* `packages/infra/search`: `SearchPort` → Postgres FTS now, Typesense later.
* `packages/infra/ai`: `EnrichmentProvider` (`summarize/classify/entities/embed`). `none` default.
* `apps/web`: dense feed UI + `/api/stories`, `/api/search`. ISR 60s for Top, SSR for Latest.

## 3. Data flow & timestamps

`published_at` (source claim) vs `discovered_at` (first seen) vs `ingested_at` vs `updated_at`.
All UTC ISO. Scheduler cadence per source speed: HN/GitHub 5–10m, blogs 30–60m, quota-low adaptive.

## 4. Dedup → clustering

```text
raw → normalized title+url → exact hash
 → SimHash hamming<=3 → near-dup
 → same-story (time+entity+title cosine) → canonical story + story_items{original,secondary,discussion,analysis}
 → related (shared entities, different event)
```

Embedding threshold pluggable later; interface stable now.

## 5. Ranking (v1, tunable)

`score = w_recency*decay(published_at) + w_trust*source_trust + w_cross*log(1+source_count) + w_eng*norm(engagement)`.
Weights in DB/config, not hard-coded. Velocity (trending) = delta score / hour.

## 6. Security / legal

SSRF: allowlist http/https, block private IP ranges, redirect cap 3, 10s timeout, 2MB cap.
Secrets via env only. Respect robots.txt, ToS, rate limits; attribution + link-out; minimal stored content.

## 7. Observability

`pino` JSON logs, `/api/health`, `source_health` (last_run, latency_ms, error_rate, fetched_count),
job attempts/latency. No PII in logs.
