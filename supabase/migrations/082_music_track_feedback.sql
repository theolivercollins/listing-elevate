-- 082: Music track feedback + ml_events event_type extension.
-- Spec: docs/specs/2026-06-11-music-feedback-design.md §A
-- DO NOT apply to prod without Oliver's explicit approval (gate per CLAUDE.md).

-- A. Per-track feedback table.
create table if not exists music_track_feedback (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references music_tracks(id) on delete cascade,
  run_id     uuid references delivery_runs(id) on delete set null,
  -- Denormalized from the track at write time so queries don't need a join.
  mood       text,
  genre      text,
  prompt     text,
  verdict    text not null check (verdict in ('up','down')),
  comment    text,
  created_at timestamptz not null default now()
);

-- Upsert uniqueness: one feedback row per (run, track).
-- Must be NON-partial: PostgREST's `onConflict: 'run_id,track_id'` emits
-- ON CONFLICT (run_id, track_id) with no predicate, and Postgres can't infer
-- a partial unique index as the arbiter — a partial index here would 500
-- every feedback upsert (42P10). NULL run_ids stay distinct by default.
create unique index if not exists idx_music_track_feedback_run_track
  on music_track_feedback(run_id, track_id);

-- Feedback retrieval: fetch recent rows by mood for the generation loop.
create index if not exists idx_music_track_feedback_mood
  on music_track_feedback(mood, created_at desc);

-- Enable RLS (service-role only, no policies — matches migration 080 pattern).
alter table music_track_feedback enable row level security;

-- B. Extend ml_events.event_type CHECK to include 'music_feedback'.
-- The constraint was created inline in migration 080; Postgres auto-names it
-- ml_events_event_type_check. Drop and re-add with the full value list.
alter table ml_events
  drop constraint if exists ml_events_event_type_check;

alter table ml_events
  add constraint ml_events_event_type_check
  check (event_type in (
    'reorder','regenerate','variant_override','script_edit',
    'voice_choice','music_choice','rating','comment','details_edit',
    'music_feedback'
  ));
