-- 077: Operator delivery pipeline — delivery_runs + scene_variants + ml_events.
-- Spec: docs/specs/2026-06-09-operator-delivery-pipeline-design.md
-- RLS: service-role only (no policies), same posture as migration 062 tables.

create table if not exists delivery_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  video_type text not null default 'just_listed'
    check (video_type in ('just_listed','just_pended','just_closed')),
  duration_seconds integer,
  stage text not null default 'intake'
    check (stage in ('intake','scraping','generating','judging','checkpoint_a','details','voiceover','music','assembling','checkpoint_b','delivered')),
  -- { price, beds, baths, sqft, mls_description, source: 'scraped'|'manual' }
  listing_details jsonb not null default '{}'::jsonb,
  -- Ordered array of scene UUIDs — the draft/operator clip order for assembly.
  scene_order jsonb,
  voiceover_script text,
  voiceover_voice_id text,
  voiceover_audio_url text,
  music_track_id uuid references music_tracks(id),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_delivery_runs_property on delivery_runs(property_id);
create index if not exists idx_delivery_runs_stage on delivery_runs(stage);

create table if not exists scene_variants (
  id uuid primary key default gen_random_uuid(),
  delivery_run_id uuid not null references delivery_runs(id) on delete cascade,
  scene_id uuid not null references scenes(id) on delete cascade,
  variant text not null check (variant in ('A','B')),
  provider text,
  provider_task_id text,
  clip_url text,
  cost_cents integer,
  gemini_scores jsonb,
  winner boolean not null default false,
  winner_source text check (winner_source in ('gemini','operator')),
  degraded boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scene_id, variant)
);
create index if not exists idx_scene_variants_run on scene_variants(delivery_run_id);
-- Poll queue: submitted but not yet collected.
create index if not exists idx_scene_variants_pending on scene_variants(provider_task_id)
  where provider_task_id is not null and clip_url is null and error is null;

create table if not exists ml_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references delivery_runs(id) on delete cascade,
  event_type text not null
    check (event_type in ('reorder','regenerate','variant_override','script_edit','voice_choice','music_choice','rating','comment','details_edit')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ml_events_run on ml_events(run_id, created_at desc);

-- Service-role-only: enable RLS with NO policies (migration 062 pattern).
alter table delivery_runs enable row level security;
alter table scene_variants enable row level security;
alter table ml_events enable row level security;
