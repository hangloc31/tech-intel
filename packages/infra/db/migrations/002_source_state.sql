-- 002_source_state: per-source fetch state for conditional GET (M1).
-- Forward-only. IF NOT EXISTS so partial/older applies stay idempotent.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS etag TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_modified TEXT;
