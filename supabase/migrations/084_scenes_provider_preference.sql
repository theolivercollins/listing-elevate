-- Migration 084: scenes.provider_preference — director intent column
--
-- Purpose: separate the director's routing intent (which provider the director
-- wants this scene to use on reruns) from the actual-ran provider recorded in
-- scenes.provider after each generation attempt.
--
-- Background: scenes.provider is written twice:
--   (a) at scene-insert time with the director's preference (pipeline.ts ~line 825)
--   (b) at submit time with the winning provider's .name after a successful call
--       (pipeline.ts runGenerationSubmit and resubmitScene)
-- The second write pollutes the column when a failover occurs:
--   e.g. Atlas-402 → native Kling 720p changes scenes.provider from 'atlas' to 'kling'.
-- On the next pipeline rerun, the router reads scenes.provider='kling' and routes to
-- native Kling's 720p-class SKU instead of the director's intended atlas/1080p-class SKU.
--
-- Fix: add provider_preference (nullable, additive) to hold the director's ORIGINAL intent.
-- pipeline.ts writes provider_preference at insert time and reads it for routing.
-- scenes.provider remains the pure what-actually-ran audit record for poll-scenes.ts.
--
-- NO BACKFILL: existing rows get NULL, which is the correct semantic
-- (null = "router decides" = recovery behavior for any legacy polluted scene).
-- Backfilling from scenes.provider would re-introduce the pollution we're fixing.
--
-- Down-migration (rollback):
--   ALTER TABLE scenes DROP COLUMN provider_preference;
-- Safe: the column is advisory / routing-only; dropping it reverts to the pre-084
-- behavior where scenes.provider is used for routing (old bug, but not data loss).

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS provider_preference text;

COMMENT ON COLUMN scenes.provider_preference IS
  'Director routing intent written at scene-insert time (migration 084). '
  'Null = router decides. Preserved across failovers unlike scenes.provider '
  'which is overwritten with the actual-ran provider name on each attempt. '
  'poll-scenes.ts uses scenes.provider (not this column) for provider reconstruction.';
