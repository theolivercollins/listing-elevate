-- 085_cost_events_bunny.sql
-- Widen cost_events.provider CHECK to include 'bunny' and 'veo'.
--
-- Context: migration 060 (cost_events_elevenlabs) set the constraint to:
--   anthropic, runway, kling, luma, shotstack, openai,
--   atlas, google, higgsfield, browserbase, apify, gemini,
--   creatomate, elevenlabs
--
-- The TypeScript union in lib/db.ts:397 was widened with | "bunny" | "veo"
-- as part of the Bunny Stream migration (branch fix/max-quality-assembly),
-- but the DB constraint was not updated in the same commit (ae012ba).
-- Without this migration every Bunny cost_event insert hits check violation
-- 23514 and is silently swallowed by .catch() call sites -- Oliver's
-- first-class cost-tracking requirement is violated in prod.
--
-- 'veo' is included here too: it was added to the TS union earlier but was
-- also absent from the 060 constraint (pre-existing drift), so we close
-- both gaps in one migration rather than scheduling a follow-up 086.
--
-- Rollback: run the compensating SQL below (or revert this commit and apply):
--   ALTER TABLE cost_events DROP CONSTRAINT IF EXISTS cost_events_provider_check;
--   ALTER TABLE cost_events ADD CONSTRAINT cost_events_provider_check
--     CHECK (provider IN (
--       'anthropic','runway','kling','luma','shotstack','openai',
--       'atlas','google','higgsfield','browserbase','apify','gemini',
--       'creatomate','elevenlabs'
--     ));
ALTER TABLE cost_events
  DROP CONSTRAINT IF EXISTS cost_events_provider_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_provider_check
  CHECK (provider IN (
    'anthropic', 'runway', 'kling', 'luma', 'shotstack', 'openai',
    'atlas', 'google', 'higgsfield', 'browserbase', 'apify', 'gemini',
    'creatomate', 'elevenlabs', 'bunny', 'veo'
  ));
