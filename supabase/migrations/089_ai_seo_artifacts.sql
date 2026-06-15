-- 089_ai_seo_artifacts.sql
-- Per docs/specs/2026-06-14-ai-seo-real-estate-design.md
--
-- Adds service-role-only generated SEO packages for public Listing Elevate
-- listing pages. One artifact is stored per public preview link.
--
-- Down-migration (rollback):
--   DROP TABLE IF EXISTS public.ai_seo_artifacts;

create table if not exists public.ai_seo_artifacts (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references public.properties(id) on delete cascade,
  preview_id         uuid not null references public.property_previews(id) on delete cascade,
  slug               text not null,
  status             text not null default 'generated' check (status in ('generated', 'failed')),
  indexable          boolean not null default false,
  title              text not null default '',
  meta_description   text not null default '',
  summary            text not null default '',
  long_description   text not null default '',
  highlights         text[] not null default '{}',
  faqs               jsonb not null default '[]'::jsonb,
  schema_json        jsonb not null default '{}'::jsonb,
  llms_markdown      text not null default '',
  source_fingerprint text not null default '',
  generated_by       text not null default 'deterministic' check (generated_by in ('deterministic', 'anthropic')),
  model              text,
  prompt_version     text not null default 'ai-seo-v1',
  cost_cents         integer not null default 0,
  error              text,
  generated_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (preview_id),
  unique (slug)
);

create index if not exists idx_ai_seo_artifacts_property
  on public.ai_seo_artifacts(property_id, updated_at desc);

create index if not exists idx_ai_seo_artifacts_indexable
  on public.ai_seo_artifacts(indexable, status, updated_at desc)
  where indexable = true and status = 'generated';

alter table public.ai_seo_artifacts enable row level security;

comment on table public.ai_seo_artifacts is
  'Generated public listing SEO artifacts. RLS has no anon/authenticated policies; service-role API handlers are the access layer.';
