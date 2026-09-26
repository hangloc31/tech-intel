-- 005_enrich_source_item: provenance per AGENTS.md (every AI row stores source_item_id).
ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS source_item_id TEXT;
