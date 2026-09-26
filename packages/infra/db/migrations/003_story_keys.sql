-- 003_story_keys: stable keys for clustering.
-- M2 v0 groups by exact content_hash; M3 adds SimHash/embedding columns.
ALTER TABLE items ADD COLUMN IF NOT EXISTS content_hash CHAR(64);
CREATE INDEX IF NOT EXISTS items_content_hash_idx ON items (content_hash) WHERE content_hash IS NOT NULL;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS content_hash CHAR(64) UNIQUE;
