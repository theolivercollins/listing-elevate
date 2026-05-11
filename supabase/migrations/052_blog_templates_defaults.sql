-- 052_blog_templates_defaults.sql
-- Templates can now capture defaults for author / category / meta fields so
-- picking a template on the compose page fills in all 5 sidebar fields, not
-- just the body HTML.

alter table blog_templates add column if not exists default_author_label text;
alter table blog_templates add column if not exists default_category_label text;
alter table blog_templates add column if not exists default_meta_title text;
alter table blog_templates add column if not exists default_meta_description text;
alter table blog_templates add column if not exists default_meta_tags text[] not null default '{}';
