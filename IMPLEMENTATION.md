# IMPLEMENTATION.md — Phased plan

## M0 Bootstrap (done in this commit)

* [x] npm workspaces monorepo, TS strict, vitest
* [x] docs + ADRs + sources.yaml + DB schema v1
* [x] domain pure logic + tests (normalize/dedup/rank)

## M1 Ingestion core — reliable fetch ✅ DONE (2026-09-23, verified live)

* [x] RSS/Atom generic connector (conditional GET + ETag via `sources.etag`, redirect cap 3 + SSRF per hop, 10s timeout, 2MB cap), HN API connector (deleted/dead skip), GitHub releases connector (curated repos, rate-limit aware).
* [x] Scheduler per-source interval + jitter (`--loop`); retry/backoff (2 retries, no retry on 429/rate-limit); `source_health` table + EMA error_rate.
* [x] Persist: `raw_contents` immutable + `items` upsert (tx per batch) via `packages/infra/src/store.ts`; `002_source_state.sql`.
* [x] Contract tests per connector (fixture XML/JSON, malformed input, 304/redirect/rate-limit) + pipeline isolation/retry tests + store integration tests.
* DoD verified: `npm run worker -- --once` ingested 1334 items / 5 sources into Neon Postgres, 0 errors.
* Known issue: `node --experimental-strip-types` doesn't map TS-style `.js` imports — worked around with `packages/ingestion/src/ts-resolve.mjs` loader (stdlib-only).

## M2 Feed + Story ✅ DONE (2026-09-23, verified live on `next start`)

* [x] Read API: `GET /api/stories?tab&cursor&limit&topic&source&q` (zod, opaque base64url cursor, max 50, `{code,message}` errors), `GET /api/stories/:id` (+404). Backed by `stories`/`story_items` (cluster v0 exact-match runs in worker post-persist so feed is populated).
* [x] Web: Home Top/Latest/Trending tabs, Story detail (original/other coverage/discussion/timeline), Filters in URL, loading/empty/error/not-found states, dark theme, focus styles, `j/k//` shortcuts.
* [x] E2E (functional, no browser): seed→ingest→cluster→`curl` API+HTML verified: pagination, filters, detail, 400/404 shapes. Playwright browser E2E deferred (needs browser install).
* Known issues: story HTML page returns 200 (not 404) on missing id — content correct, API 404 correct (Next 15.1→15.5.26 still 200; root cause TBD, SEO-only wart).

## M3 Dedup + Cluster v1 ✅ DONE (2026-09-23, verified live)

* [x] SimHash (hex16 in `items.simhash`) + 72h window + entity-overlap blocking (same-title pairs included so entity-less dupes still merge); `story_items` roles content-driven (`original`/`discussion`/`secondary`).
* [x] `story_links` (undirected, canonical `a<b`) for `related`; merge moves items+links, recomputes score/count/first_seen, deletes emptied story. Set-based SQL (constant round-trips) + blocking — 1334 stories merge in ~2s.
* [x] UI: grouped member sources on cards, Other coverage + Related stories on detail.
* [x] Integration tests (cluster + merge incl. idempotent rerun). Result on prod data: 1333 stories, 8 related links.
* Deferred: admin split/merge endpoint (not needed yet); embedding-threshold merge (interface stable, M-backlog).

## M4 Search / Topics / Entities ✅ DONE (2026-09-23, verified live)

* [x] Postgres FTS (`ts_rank_cd` + `plainto_tsquery`, uses existing `items.search` GIN index) behind `SearchPort`; `PgSearch` in `packages/infra/src/search.ts` (zero relative runtime imports so Next.js can bundle it; swap to Typesense later).
* [x] `GET /api/search?q&topic&source&author&entity&limit` (+ `/search` page with `ts_headline` snippets), `q` on `/api/stories` upgraded ILIKE→FTS, `entity` filter added, `/topic/[name]` page, topic datalist from `topics.yaml`.
* [x] Entity extractor v1 (gazetteer) already feeds `items.entities` at ingest (M1).
* [x] Search integration test (ranking + filters). Verified live: FTS ranking, filters, snippets, topic page.

## M5 AI enrichment (async) ✅ DONE (2026-09-23, stub-verified; live provider needs key)

* [x] `EnrichmentProvider` + `OpenAICompatProvider` (fetch-only, no deps; OpenAI/OpenRouter/Ollama/vLLM); `AI_PROVIDER=none` default -> everything skipped gracefully (`ai.disabled` logged once).
* [x] Jobs pipeline (`packages/infra/src/jobs.ts`): enqueue recent unenriched items, claim (`SKIP LOCKED`), exponential backoff, `jobs_failed` after max attempts. Provenance on every row: `source_item_id + raw_id + model_name + model_version + prompt_hash` (migration 005).
* [x] Worker: `--loop` runs enrichment sweep; `--once` only with `--enrich`.
* [x] UI: AI summary section (summary + why-it-matters + key points + model label), hidden when absent. Verified render with temp row (removed after).
* [x] Tests: stub-provider enqueue/process/provenance/idempotency + dead-letter path.
* Needs you: set `AI_PROVIDER=openai`, `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL` to enrich for real.

## M6 Expand sources ✅ DONE (2026-09-23, verified live)

* [x] Reddit public-JSON connector (keyless, 429-aware, skips stickied), Product Hunt GraphQL + X abstractions (refuse without keys, parse-ready, fixture-tested). All disabled by default; worker logs `disabled_no_key` instead of burning quota.
* [x] Blogs pack: 21 feeds added to `sources.yaml`, every URL verified live (200) before merge. Full `--once`: 26/26 sources, 0 errors, ~2500 items.
* [x] Parser hardening from the pack rollout: single-quoted `href` (tbray.org).

Each milestone: impl + tests + logging + config + migration + security review + docs update.

## UI refresh + ranking decay ✅ DONE (2026-09-26)

Dense-terminal voice (HN/Linear): hairline rows, one accent, no magazine grid — chosen because
only 129/2797 items have artwork and 76% carry no topic, so an image- or topic-led layout would
render mostly empty.

* [x] Design system: `app/globals.css` tokens (`light-dark()`, dark default + system/light/dark
  toggle) + CSS Modules per component. Replaced ~300 lines of inline `style={{}}`. No new dep.
* [x] Shell: sticky blurred header, global search → `/search`, two-column grid (feed + 300px
  sticky rail), collapses to one column < 1024px.
* [x] Cards: hero variant for a lead story *that actually has an image*, dense row otherwise.
  `N sources` badge only renders when > 1 outlet; timestamps right-aligned via CSS, not inline.
* [x] Nav: segmented Top/Latest/Trending, topic rail driven by live counts (no dead links),
  source/entity inputs collapsed behind a "Refine" disclosure. State stays in the URL.
* [x] `lib/insights.ts`: small time-bounded aggregates for the rail, returns `null` on failure so
  the feed never depends on decoration.
* [x] Detail page restyle; AI panel stays hidden while `enrichments` is empty (it was a permanent
  empty promise).
* [x] Favicons resolve from the item URL's host. Source ids are slugs (`hackernews`) and were
  being passed to the favicon service, producing 404s on every card.
* [x] **Ranking decay**: `packages/infra/src/rerank.ts` re-applies `domain.score()` against the
  current clock. `clusterBatch` wrote `stories.score` once at ingest using the story's
  `published_at` as "now", so recency never decayed and 2026-09-23 stories outranked today's news
  on the Top tab. Runs every worker `--once`, and every 15 min in `--loop`.
* [x] Tests: `rank.test.ts` covers decay monotonicity, half-life, the non-recency floor, and
  fresh-beats-stale. Fixed two over-strict assertions of my own while writing it.
* Verified in Chromium: 7 routes 200, no hydration warnings, 20 rows + 3 rail cards, zero console
  errors. `typecheck` clean, 33 unit tests pass, `next build` clean.
* Reranking 448 stories moved the Top feed from 2026-09-23 to 2026-09-26 entries.

Deliberately out of scope (phase 2): cross-source clustering, topic/entity backfill, MMR
diversity, enabling AI enrichment.

## P0 reliability ✅ DONE (2026-09-26)

* [x] Freshness window + per-source cap in `runOnce` (`maxAgeDays=30`, `maxItemsPerSource=100`,
  `nowMs` injected). Archive feeds no longer re-ingest history: first live run dropped 2097 stale
  items (openai-blog 1163, huggingface-blog 851) and stored 206, 0 errors across 26/26 sources.
  Unparseable dates are kept, never filtered.
* [x] `persistBatch` rewritten to 2 round-trips per 500-row chunk via `jsonb_to_recordset`
  (was 2N queries, ~5k round-trips per full run). Same transaction, same upsert semantics.
  Verified live: insert 3 / upsert-repeat 3 / bulk 600 (chunk split) / array+null round-trip —
  temp source removed afterwards, 0 rows left.
* [x] `npm run db:migrate`: `packages/infra/src/migrate.ts` replays `*.sql` in order with
  `schema_migrations` tracking. All 6 existing files are idempotent, so first run replayed
  them safely; second run is a no-op. README quick-start updated (no more manual `psql -f` loop).
* [x] Secrets: README documents rotation steps for Neon + GitHub PAT. `.env` never committed
  (`git log -- .env` empty), `.env.example` holds placeholders only.
* [x] Tests: pipeline age/cap cases + migrate sort/skip cases. Typecheck clean, 35 unit tests pass.
* Note: 2250 pre-existing items older than 30d stay in the DB (no destructive delete without ADR).
  They no longer compete for the Top feed because rerank decayed their recency to ~0.

## UX P0 ✅ DONE (2026-09-26)

* [x] `SourceIcon` is now a client component: a favicon 404 falls back to the source initial
  instead of a broken-image icon (verified with a real failed request in Chromium).
* [x] Detail page shows "Ranked #N in Top · N outlets · origin trust N% · first seen …" with a
  tooltip naming the signals. The raw `score 0.xxx` is gone from the UI (still in the API).
  Rank comes from a `(score, id)` count with the feed's exact ordering.
* [x] Trending tab carries its window: "Trending · 48h" (reads `TRENDING_WINDOW_HOURS`, same
  default as the query layer) + tooltip.
* [x] `LoadMore` client component: appends the next cursor page in place via `/api/stories`,
  keeps scroll, updates the URL to the latest cursor (refresh-safe), and degrades to the old
  full-page link without JS. Wired into home + topic pages. Verified 20 → 40 rows in Chromium.
* [x] Search boxes disambiguated: header "Search everything…" (global FTS) vs feed
  "Filter this list…" (scoped filter).
* [x] Drive-by: `app/icon.svg` kills the `/favicon.ico` 404; fixed a hydration warning
  (`suppressHydrationWarning` for the pre-paint theme script).

## Hotfix: feed showed no news (2026-09-26)

Symptom: web rendered "Feed unavailable" (API 500) and no new items since 2026-09-23, while
the worker reported every source as `ok` with `stored: 0`.

Root cause: nothing loaded the repo-root `.env`. Next.js only auto-loads env files from the
app directory (`apps/web`), and the worker ran under bare `node` with no dotenv. So
`DATABASE_URL` was unset in both processes: the web pool threw on every query, and the
worker fell back to its "fetch-only" mode — fetching and normalizing ~2.5k items, then
discarding them.

* [x] Web: `apps/web/next.config.mjs` loads the root `.env` via `apps/web/lib/env.mjs`
  (stdlib parser, real env vars win, keys-only log). Added `serverExternalPackages: ["pg"]`.
* [x] Worker: `node --env-file-if-exists=../../.env` in the npm script (Node ≥ 22.9,
  `engines` bumped); no dependency added.
* [x] Worker: DB failure is now fatal (`db.unavailable`, exit 1) instead of a silent
  fetch-only degradation.
* [x] Fixed flag forwarding: `npm run worker -- --loop/--enrich` were consumed by the inner
  `npm run` and silently ignored (and a hardcoded `--once` would have beaten `--loop`).
* [x] Tests: `apps/web/lib/env.test.mjs` (7 cases, incl. quoted DATABASE_URL regression).
* Verified: full `--once` run 25/25 sources, 0 errors, 2.8k items upserted, 216 new;
  web feed serving stories dated 2026-09-26; `next build` clean.
