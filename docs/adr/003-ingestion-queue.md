# ADR-003 — Postgres jobs table instead of Redis/BullMQ for MVP

Date: 2026-09-23. Status: accepted.

## Context

Need async fetch/enrich/embed/dedup/cluster/rank with retries. Redis unavailable locally; minimize ops.

## Decision

`jobs(kind, payload, run_at, attempts, max_attempts)` polled by Node worker with `FOR UPDATE SKIP LOCKED`.
Idempotent handlers, exponential backoff, `jobs_failed` dead-letter. Migrate to BullMQ/Redis when throughput or latency demands it.

## Consequences

+ Zero extra infra, transactional enqueue. − Polling latency ~seconds, lower throughput; acceptable for 10k items/day.
