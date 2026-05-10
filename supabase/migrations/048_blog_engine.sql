-- 048_blog_engine.sql
-- Phase 1 schema for the blog engine. Multi-site from day 1, Sierra adapter only.

create type blog_post_state as enum (
  'research_due','topics_proposed','topic_picked',
  'draft_due','draft_ready','awaiting_approval',
  'publish_due','publishing','live',
  'edit_pending','editing','quarantined'
);

create type blog_job_kind as enum (
  'research','distill_topics','draft','image_match',
  'publish','edit','fetch_taxonomy','distill_correction'
);

create type blog_job_state as enum ('queued','running','done','failed');

create type blog_correction_status as enum ('proposed','accepted','discarded','edited');

create table blog_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_kind text not null check (host_kind in ('sierra','agent_fire')),
  base_url text not null,
  bot_credentials_ref text,
  default_author_id text,
  default_category_id text,
  taxonomy_cache jsonb not null default '{}'::jsonb,
  browserbase_context_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table blog_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  state blog_post_state not null default 'draft_ready',
  topic_suggestion_id uuid,
  title text not null,
  slug text,
  body_html text not null,
  meta_title text,
  meta_description text,
  meta_tags text[] not null default '{}',
  image_id uuid,
  author_label text,
  category_label text,
  external_post_url text,
  external_post_id text,
  publish_at timestamptz,
  regen_count int not null default 0,
  cost_usd_cents int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_posts_site_state_idx on blog_posts(site_id, state);

create table blog_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references blog_posts(id),
  site_id uuid not null references blog_sites(id),
  kind blog_job_kind not null,
  state blog_job_state not null default 'queued',
  attempts int not null default 0,
  last_error text,
  browserbase_session_id text,
  replay_url text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index blog_jobs_due_idx on blog_jobs(state, scheduled_at) where state = 'queued';
create index blog_jobs_site_kind_idx on blog_jobs(site_id, kind, state);

create or replace function blog_cost_events_after_insert()
returns trigger language plpgsql as $$
begin
  if new.post_id is not null and exists (select 1 from blog_posts p where p.id = new.post_id) then
    update blog_posts
       set cost_usd_cents = cost_usd_cents + coalesce(new.cost_cents, 0),
           updated_at = now()
     where id = new.post_id;
  end if;
  return new;
end;
$$;

alter table cost_events add column if not exists post_id uuid;
alter table cost_events add column if not exists site_id uuid;

create trigger blog_cost_events_after_insert_trg
after insert on cost_events
for each row execute function blog_cost_events_after_insert();

create table blog_topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  batch_date date not null,
  rank smallint not null check (rank between 1 and 3),
  title text not null,
  angle text,
  sources jsonb not null default '{}'::jsonb,
  picked boolean not null default false,
  post_id uuid references blog_posts(id),
  created_at timestamptz not null default now(),
  unique (site_id, batch_date, rank)
);

create table blog_research_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  run_date date not null,
  sources_used text[] not null default '{}',
  raw_findings jsonb not null default '{}'::jsonb,
  selected_topic_ids uuid[] not null default '{}',
  cost_usd_cents int not null default 0,
  created_at timestamptz not null default now()
);

create table blog_images (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  blob_url text not null,
  mime text,
  width int, height int,
  uploaded_by uuid,
  file_hash text unique,
  vision_tags text[] not null default '{}',
  vision_caption text,
  embedding vector(768),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table blog_image_usages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references blog_posts(id),
  image_id uuid not null references blog_images(id),
  used_at timestamptz not null default now()
);

create table blog_corrections (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references blog_posts(id),
  site_id uuid not null references blog_sites(id),
  field text not null,
  before_text text,
  after_text text,
  diff_summary text,
  rule_extracted text,
  applies_to_site_only boolean not null default false,
  status blog_correction_status not null default 'proposed',
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table blog_style_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  rule text not null,
  source_correction_id uuid references blog_corrections(id),
  weight smallint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_applied_at timestamptz
);
