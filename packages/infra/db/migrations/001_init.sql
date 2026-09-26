-- 001_init: Postgres 16 + pgvector. Forward-only.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trust REAL NOT NULL DEFAULT 0.5,
  cadence_ms INTEGER NOT NULL DEFAULT 600000,
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_contents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  UNIQUE (source_id, external_id, checksum)
);

CREATE TABLE IF NOT EXISTS items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  author TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_type TEXT NOT NULL DEFAULT 'article',
  summary TEXT,
  topics TEXT[] NOT NULL DEFAULT '{}',
  entities TEXT[] NOT NULL DEFAULT '{}',
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,''))) STORED,
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS items_search_idx ON items USING GIN (search);
CREATE INDEX IF NOT EXISTS items_published_idx ON items (published_at DESC);
CREATE INDEX IF NOT EXISTS items_canonical_idx ON items (canonical_url);

CREATE TABLE IF NOT EXISTS stories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  original_source_id TEXT REFERENCES sources(id),
  source_count INTEGER NOT NULL DEFAULT 1,
  score REAL NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_items (
  story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'secondary', -- original|secondary|discussion|analysis
  PRIMARY KEY (story_id, item_id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  item_id BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding vector(1536),
  model TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  raw_id BIGINT REFERENCES raw_contents(id),
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'v1',
  prompt_hash CHAR(64) NOT NULL DEFAULT '',
  summary TEXT,
  why_it_matters TEXT,
  key_points JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL, -- fetch|enrich|embed|cluster|rank
  payload JSONB NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  claimed_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS jobs_run_at_idx ON jobs (run_at) WHERE claimed_at IS NULL;

CREATE TABLE IF NOT EXISTS jobs_failed (
  LIKE jobs INCLUDING ALL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY REFERENCES sources(id),
  last_run_at TIMESTAMPTZ,
  latency_ms INTEGER,
  error_rate REAL NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0
);
