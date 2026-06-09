-- 075_creatives.sql — Vimeo-style shareable creatives for Operator Studio
create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  source text not null check (source in ('upload','render')),
  kind text not null check (kind in ('video','image')),
  bucket text not null,
  storage_path text,
  public_url text,
  thumbnail_url text,
  mime_type text,
  duration_seconds numeric,
  width int,
  height int,
  file_size_bytes bigint,
  property_id uuid references public.properties(id) on delete set null,
  share_token text not null unique,
  visibility text not null default 'unlisted' check (visibility in ('unlisted','public')),
  allow_download boolean not null default false,
  allow_embed boolean not null default true,
  presentation_enabled boolean not null default true,
  password_hash text,
  expires_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creatives_created_at_idx on public.creatives (created_at desc);
create index if not exists creatives_property_id_idx on public.creatives (property_id);

alter table public.creatives enable row level security;
-- No anon/auth policies: service-role only (matches property_previews).

create or replace function public.increment_creative_view(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.creatives
     set view_count = view_count + 1,
         last_viewed_at = now()
   where share_token = p_token;
$$;

-- Private storage bucket for uploaded creatives (signed-URL playback only).
insert into storage.buckets (id, name, public)
values ('creatives','creatives', false)
on conflict (id) do nothing;
