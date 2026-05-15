-- 056_blog_posts_image_id_fk.sql
-- Adds the missing foreign key on blog_posts.image_id → blog_images.id so that
-- PostgREST embeds (`image:image_id (...)`) resolve. Without this FK,
-- /api/blog/posts list + detail return 400 and the dashboard hangs at "Loading…".
-- 0 orphaned image_id values at apply time (2026-05-14); safe to add directly.

alter table blog_posts
  add constraint blog_posts_image_id_fkey
  foreign key (image_id) references blog_images(id)
  on delete set null;

notify pgrst, 'reload schema';
