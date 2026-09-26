-- 006_images: thumbnails for feed cards (M-UI). Null = hide image.
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_url TEXT;
