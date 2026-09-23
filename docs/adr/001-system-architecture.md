# ADR-001 — Monolith-modular (npm workspaces + Next.js)

Date: 2026-09-23. Status: accepted.

## Context

Team of one, need to ship MVP fast, scale path to 10k→1M items/day. No Docker locally, Node 24 available.

## Decision

Single repo, `apps/web` (Next.js 15) + `packages/*`. No microservices in MVP.
Domain pure (`packages/domain`), infra behind ports, ingestion isolated.

## Consequences

+ One deploy, one CI, easy local dev. − Must enforce boundaries via AGENTS.md + imports;
split to services later only if worker load demands it (path: extract `packages/ingestion` to standalone service, API unchanged).
