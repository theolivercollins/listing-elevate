-- 049c_blog_job_kind_image_tag.sql
-- Phase 2 image-tagging job kind. The original 048 enum included image_match
-- but not image_tag — separate kinds because image_match runs at draft time
-- against an existing library, while image_tag runs once per image during
-- ingest to populate vision_tags + embedding.
--
-- Postgres ALTER TYPE ADD VALUE cannot run inside a transaction wrapping
-- subsequent uses of the new value, so this is its own migration.
alter type blog_job_kind add value if not exists 'image_tag';
