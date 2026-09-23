# AGENTS.md — Engineering rules (human + AI agents)

## Architecture

* Never bypass `domain ↔ infra` boundary. No circular deps (`madge` check in CI later).
* Source adapters (`packages/ingestion/connectors/*`) contain NO business logic, NO ranking, NO SQL.
  They only fetch/parse/normalize to `NormalizedItem`.
* Business logic lives in `packages/domain` as pure functions (no I/O, no `Date.now()` without injection).
* Infra adapters behind ports (`SearchPort`, `EnrichmentProvider`, `QueuePort`). No direct provider imports in domain/web.

## Data

* `raw_contents` immutable — never overwrite with normalized data. Corrections = new rows.
* Every AI row must store `source_item_id + raw_id + model_name + model_version + prompt_hash`.
* Migrations versioned in `packages/infra/db/migrations/`, forward-only, no destructive alter without ADR.
* Timestamps UTC ISO; distinguish `published_at/discovered_at/ingested_at/updated_at`. Don't conflate.

## API

* `zod` validate all inputs (query/body/params). Consistent error `{ code, message }`.
* Cursor pagination (`?cursor&limit`, max 50). Stable contracts — breaking change needs version bump.
* SSRF: fetch only http/https, block private/loopback/link-local, redirect≤3, timeout 10s, body≤2MB.

## Frontend (`apps/web`)

* Small reusable components, server components by default, client only for interactivity.
* Every list: loading / empty / error states. Accessibility: semantic HTML, focus styles, keyboard `/ j k`.
* No unnecessary client state; URL holds filter state (`?topic&source&q`).

## Testing

* New feature → appropriate test. Bugfix → regression test. New connector → contract test with fixtures.
* Unit: parser/normalizer/dedup/rank (vitest). Integration: connector+db+queue (needs `DATABASE_URL`).
  E2E: ingest→feed (playwright, M2+).
* Never add fake data in production path; mocks only in `__tests__`/fixtures.

## Git / deps

* No secrets in git. No generated junk (`dist`, `.next`). Small logical commits.
* No new dep for convenience: check maintenance, license, size, security, alternatives. Prefer stdlib.
* Don't touch unrelated files. Update docs when behavior changes.
