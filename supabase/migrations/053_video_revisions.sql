-- 053: Video editing foundation
-- Adds assembly_timeline persistence to properties and video_revisions table
-- for the conversational revision chatbot.

-- 1. Persist the rendered assembly timeline JSON on the property so it can
--    be loaded, modified, and re-rendered by the revision engine.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assembly_timeline jsonb;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assembly_timeline_version integer DEFAULT 0;
-- Track which assembly provider rendered the current video.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assembly_provider text DEFAULT 'shotstack';

-- 2. Revision history — one row per user revision request.
CREATE TABLE IF NOT EXISTS video_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- What the user asked for
  user_message text NOT NULL,

  -- What the LLM decided to do
  tool_calls jsonb,           -- Array of tool invocations [{name, args, result}]
  reasoning text,             -- LLM's chain-of-thought summary

  -- Before/after timeline snapshots
  timeline_before jsonb NOT NULL,
  timeline_after jsonb NOT NULL,

  -- Render result
  render_job_id text,
  render_status text NOT NULL DEFAULT 'pending'
    CHECK (render_status IN ('pending', 'rendering', 'complete', 'failed')),
  horizontal_video_url text,
  vertical_video_url text,
  render_error text,

  -- Cost
  cost_cents integer NOT NULL DEFAULT 0,

  -- Ordering
  revision_number integer NOT NULL,

  -- Whether this revision is the currently "active" version
  is_active boolean NOT NULL DEFAULT false,

  -- Metadata (provider used, model, token counts, etc.)
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_video_revisions_property
  ON video_revisions(property_id);
CREATE INDEX IF NOT EXISTS idx_video_revisions_pending
  ON video_revisions(render_status) WHERE render_status IN ('pending', 'rendering');

-- Widen cost_events.provider CHECK to include 'creatomate'.
-- The previous constraint (verified via pg_constraint at migration-write
-- time) was:
--   provider IN ('anthropic','runway','kling','luma','shotstack','openai',
--                'atlas','google','higgsfield','browserbase','apify','gemini')
-- This drops the old constraint and re-adds the same set + 'creatomate'.
-- Additive only; no existing rows are invalidated.
ALTER TABLE cost_events
  DROP CONSTRAINT IF EXISTS cost_events_provider_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_provider_check
  CHECK (provider IN (
    'anthropic', 'runway', 'kling', 'luma', 'shotstack', 'openai',
    'atlas', 'google', 'higgsfield', 'browserbase', 'apify', 'gemini',
    'creatomate'
  ));
