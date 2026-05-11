-- 051_blog_templates.sql
-- Templates that users save (HTML structure) and pick from when composing posts
-- or feed to the Claude AI draft endpoint as a structural skeleton.

create table blog_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  name text not null,
  description text,
  body_html text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_templates_site_active_idx
  on blog_templates(site_id, active)
  where active = true;
