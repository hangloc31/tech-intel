# ADR-002 — Postgres 16 + pgvector + FTS as primary store

Date: 2026-09-23. Status: accepted.

## Context

Need relations (Story-Item-Source), time-series freshness, full-text search, future vector similarity.
Avoid operating ES/Qdrant/Redis on day one. Dev without Docker → managed Postgres (Neon/Supabase).

## Decision

Postgres single primary: relational + `tsvector` FTS + `pgvector` embeddings + `jobs` queue table.
Drizzle ORM, versioned SQL migrations.

## Consequences

+ One stateful service, boring, transactional outbox for jobs. − FTS/vector recall weaker than dedicated engines;
mitigation: `SearchPort`/`EmbeddingPort` abstraction, swap to Typesense/Qdrant later without API change.
