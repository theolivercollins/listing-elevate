-- 056_cost_events_elevenlabs.sql
-- Widen cost_events.provider CHECK to include 'elevenlabs' (AI voiceover TTS).
-- The constraint as of migration 053 includes:
--   'anthropic','runway','kling','luma','shotstack','openai',
--   'atlas','google','higgsfield','browserbase','apify','gemini','creatomate'
-- 'apify' and 'anthropic' are already included; only 'elevenlabs' is new.
ALTER TABLE cost_events
  DROP CONSTRAINT IF EXISTS cost_events_provider_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_provider_check
  CHECK (provider IN (
    'anthropic', 'runway', 'kling', 'luma', 'shotstack', 'openai',
    'atlas', 'google', 'higgsfield', 'browserbase', 'apify', 'gemini',
    'creatomate', 'elevenlabs'
  ));
