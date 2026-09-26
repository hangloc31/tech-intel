-- 004_dedup: near-duplicate keys + related-story links (M3).
ALTER TABLE items ADD COLUMN IF NOT EXISTS simhash CHAR(16);
CREATE INDEX IF NOT EXISTS items_simhash_idx ON items (simhash) WHERE simhash IS NOT NULL;
-- Undirected link between distinct stories; enforced canonical ordering a < b.
CREATE TABLE IF NOT EXISTS story_links (
  story_a BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  story_b BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'related', -- related
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_a, story_b),
  CHECK (story_a < story_b)
);
