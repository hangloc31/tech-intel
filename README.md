# Tech Intel — Technology Intelligence Platform

> "One place to understand what is happening in technology right now."

Signal > noise. Multi-source ingestion → normalize → deduplicate → cluster → rank → serve.

## Quick start (M0/M1, no Docker required)

```bash
# 1. Provision Postgres 16 + pgvector (Neon/Supabase free tier OK for dev)
cp .env.example .env   # set DATABASE_URL (quote it: single quotes, URL contains &)

# 2. Install + typecheck + test (unit always; integration needs DATABASE_URL)
npm install
npm run typecheck
npm test

# 3. Apply migrations, then run ingestion worker (26 sources enabled by default)
npm run db:migrate
npm run worker -- --once   # or --loop for the scheduler daemon, --enrich for AI summaries

# 4. Run web
npm run dev --workspace=apps/web
```

## Environment

One `.env` at the **repo root** configures both apps — no per-app env file, no `dotenv`
dependency (both loaders are stdlib):

| Consumer | How it loads `.env` |
| --- | --- |
| worker (`packages/ingestion`) | `node --env-file-if-exists=../../.env` in the npm script (needs Node ≥ 22.9) |
| web (`apps/web`) | `apps/web/next.config.mjs` → `apps/web/lib/env.mjs` (Next only auto-loads env files from the app dir) |

Real environment variables always win over the file, so CI and production can inject
`DATABASE_URL` without touching `.env`. The worker **fails fast** (exit 1, `db.unavailable`)
when `DATABASE_URL` is missing or unreachable — it no longer degrades to a fetch-only run
that reports success while persisting nothing.

## Secrets

`.env` is gitignored and has never been committed (`git log -- .env` is empty — keep it that way).
Still, rotate immediately if a secret ever touches a terminal, log file, or screenshot:

1. **Neon**: dashboard → project → rotate password, update `DATABASE_URL` in `.env`.
2. **GitHub PAT** (`GITHUB_TOKEN`, optional — raises the releases API quota): GitHub Settings →
   Developer settings → Personal access tokens → revoke the old one. Create a new fine-grained
   token with read-only access to public repositories only, then put it in `.env`.
   Never use a token with write scopes here; the worker only reads releases.
3. Verify: `git status --short` must never list `.env`, and `git log -- .env` must stay empty.

RSS sources send conditional requests (`ETag` / `Last-Modified`), so a source that has not
changed since the last run logs `fetched: 0` — that is a cache hit, not a failure.

## UI

Dense-terminal feed (HN/Linear), dark by default with a system/light/dark toggle.

```text
apps/web/app/globals.css          design tokens (light-dark()), base styles
apps/web/app/components/*.module.css
apps/web/lib/insights.ts          read-only aggregates for the right rail
packages/infra/src/rerank.ts      re-scores stories so recency decays with time
```

No CSS framework — tokens + CSS Modules only. Filter state lives in the URL
(`?tab&topic&source&entity&q&cursor`); the only client state is the theme choice and keyboard nav.

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
