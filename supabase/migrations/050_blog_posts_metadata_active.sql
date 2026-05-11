-- 050_blog_posts_metadata_active.sql
-- Phase 5: add metadata jsonb (for authored='manual'|'auto' flag and any
-- future free-form fields) and active boolean (for soft-archive from the
-- Posts list "Archive" row action).

alter table blog_posts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table blog_posts add column if not exists active boolean not null default true;

create index if not exists blog_posts_active_idx on blog_posts(active) where active = true;
