-- 058_emails.sql
-- Email composer feature: drag-and-drop email templates + AI-composed emails.
-- Mirrors the blog_templates / blog_posts shape so the same ergonomics apply
-- (site-scoped, soft-delete via active=false, jsonb metadata, link to source post).

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  name text not null,
  description text,
  design_json jsonb not null default '{}'::jsonb,
  body_html text not null default '',
  thumbnail_url text,
  default_subject text,
  default_preheader text,
  default_from_name text,
  default_from_email text,
  default_audience text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_templates_site_active_idx
  on email_templates(site_id, active)
  where active = true;

create table emails (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id) on delete cascade,
  template_id uuid references email_templates(id) on delete set null,
  source_post_id uuid references blog_posts(id) on delete set null,
  state text not null default 'draft',
  subject text not null default '',
  preheader text,
  from_name text,
  from_email text,
  reply_to text,
  audience text,
  recipients_json jsonb not null default '[]'::jsonb,
  design_json jsonb not null default '{}'::jsonb,
  body_html text not null default '',
  body_text text,
  cost_usd_cents integer not null default 0,
  send_provider text,
  send_provider_message_id text,
  sent_to text[],
  sent_at timestamptz,
  send_error text,
  authored text not null default 'manual',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emails_state_check check (state in ('draft','ready','sending','sent','failed'))
);

create index emails_site_state_idx
  on emails(site_id, state, updated_at desc)
  where active = true;

create index emails_source_post_idx
  on emails(source_post_id)
  where source_post_id is not null;

notify pgrst, 'reload schema';
