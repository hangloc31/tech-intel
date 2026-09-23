# ADR-005 — AI enrichment async + optional (never on critical path)

Date: 2026-09-23. Status: accepted.

## Context

AI useful for summary/classify/entities/dedup/cluster/why-it-matters, but providers flaky, costly, untrusted.

## Decision

`EnrichmentProvider` with `none` default (heuristics only). Enrichment runs as retryable jobs after items stored.
Feed serves raw+normalized immediately. All AI rows carry provenance (`raw_id`, model, prompt hash).

## Consequences

+ Ingestion resilient to AI outage; legal minimal-copy preserved. − Feed less rich until jobs drain; UI must handle missing enrichment.
