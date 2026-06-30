-- Migration 091 — per-run autopilot resolve lease (delivery_runs.resolving_at)
--
-- WHY: overlapping autopilot cron sweeps (a single resolver — ElevenLabs synth +
-- Haiku picks + Creatomate render — can outrun the 60s cron interval) OR a cron
-- sweep racing the inline kick can BOTH pass every guard in resolveGate() and BOTH
-- pay a provider. advanceRun()'s compare-and-swap dedups the *stage advance*, not
-- the *spend*. resolving_at is a CAS-claimed lease: resolveGate() claims it AFTER
-- its four guards and BEFORE dispatching to a per-gate resolver, then clears it in
-- a finally. A 10-minute TTL lets a crashed/Vercel-killed resolver's lease be
-- reclaimed by a later sweep so a run is never wedged.
--
-- See lib/delivery/auto-run.ts (claimResolveLease / releaseResolveLease).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS — safe to re-run. Pure additive, no backfill.
alter table delivery_runs
  add column if not exists resolving_at timestamptz;

comment on column delivery_runs.resolving_at is
  'Autopilot resolve lease. Set to now() by resolveGate() (lib/delivery/auto-run.ts) before a per-gate resolver runs and cleared (null) afterwards. A concurrent resolver skips a run whose resolving_at is within the last 10 minutes — the primary guard against double-spend from overlapping sweeps. NULL = not currently being resolved.';

-- ROLLBACK:
--   alter table delivery_runs drop column if exists resolving_at;
