# IMPLEMENTATION.md — Phased plan

## M0 Bootstrap (done in this commit)

* [x] npm workspaces monorepo, TS strict, vitest
* [x] docs + ADRs + sources.yaml + DB schema v1
* [x] domain pure logic + tests (normalize/dedup/rank)

## M1 Ingestion core — reliable fetch

* RSS/Atom generic connector (conditional GET, ETag), HN API connector, GitHub releases connector.
* Scheduler per-source interval + jitter; retry/backoff; `source_health` table.
* Contract tests per connector (fixture XML/JSON, malformed input).
* DoD: `npm run worker -- --once` ingests 20+ feeds into Postgres without crash on 1 source failing.

## M2 Feed + Story

* Read API: `GET /api/stories?cursor&topic&source`, `GET /api/stories/:id`.
* Web: Home (Top/Latest/Trending tabs), Story detail (original/other coverage/discussion/timeline).
* Loading/empty/error states, dark mode, `j/k//` shortcuts.
* E2E: ingest fixture → feed shows clustered story.

## M3 Dedup + Cluster v1

* SimHash + 72h window + entity overlap; `story_items` roles.
* UI grouped sources; admin endpoint to split/merge (future).

## M4 Search / Topics / Entities

* Postgres FTS + filters; `SearchPort`; taxonomy YAML; entity extractor v1 (regex gazetteer: companies/models/langs).

## M5 AI enrichment (async)

* `EnrichmentProvider` + jobs; summary + why-it-matters + key points with provenance.
* Graceful when `AI_PROVIDER=none`.

## M6 Expand sources

* Reddit API, ProductHunt, X provider abstraction (disabled without keys), company/research blogs pack (50+ feeds).

Each milestone: impl + tests + logging + config + migration + security review + docs update.
