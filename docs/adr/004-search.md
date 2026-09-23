# ADR-004 — Full-text first, semantic later (SearchPort)

Date: 2026-09-23. Status: accepted.

## Context

Search must support text + filters (source/topic/date/author/entity) on day one; semantic nice-to-have.

## Decision

`SearchPort { indexItem, search }` backed by Postgres FTS now. Embeddings stored in `pgvector` for future hybrid.
Contract tests against port so engine swap is safe.

## Consequences

+ Ships fast, no extra service. − Typo tolerance/ranking weaker; upgrade path explicit in M4/M5.
