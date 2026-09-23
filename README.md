# Tech Intel — Technology Intelligence Platform

> "One place to understand what is happening in technology right now."

Signal > noise. Multi-source ingestion → normalize → deduplicate → cluster → rank → serve.

## Quick start (M0/M1, no Docker required)

```bash
# 1. Provision Postgres 16 + pgvector (Neon/Supabase free tier OK for dev)
cp .env.example .env

# 2. Install + typecheck + test pure domain/ingestion logic
npm install
npm run typecheck
npm test

# 3. Run ingestion worker (RSS + HackerNews enabled by default)
npm run worker

# 4. Run web (after `apps/web` deps installed)
npm run dev --workspace=apps/web
```

## Repo layout

```text
apps/web/                 # Next.js 15 read UI + Route Handlers API
packages/config/          # sources.yaml + loader + env schema
packages/domain/          # pure logic: normalize, dedup, cluster, rank, topics
packages/ingestion/       # ports + connectors (rss, hn, github) + pipeline + scheduler + worker
packages/infra/           # db schema/migrations, queue(jobs table), search port, ai port
docs/adr/                 # architecture decision records
```

## Docs

* `PRODUCT.md` — product vision, users, screens, MVP boundary
* `ARCHITECTURE.md` — system, data flow, components
* `IMPLEMENTATION.md` — phased milestones M0→M6
* `AGENTS.md` — engineering rules for human + AI agents

## Principles

1. Correctness > features. 2. Raw data immutable. 3. AI async + optional. 4. Provenance everywhere.
5. Boring tech. 6. Source adapters isolated, no business logic in adapters.
