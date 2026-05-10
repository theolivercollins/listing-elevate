-- 049a_blog_images_metadata.sql
-- Add a free-form metadata jsonb column to blog_images. Used by Phase 2's
-- Drive import script to capture folder_hint and original filename, and by
-- the vision tagger to record raw model output for future debugging.
alter table blog_images add column if not exists metadata jsonb not null default '{}'::jsonb;
