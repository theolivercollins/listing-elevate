-- 056: ElevenLabs voiceover integration.
-- Two product features land together:
--   1. Per-video voiceover ($10) — toggle already exists on properties.add_voiceover;
--      this migration adds the pipeline-written output columns.
--   2. Voice cloning ($125 one-time) — toggle already exists on properties.add_voice_clone;
--      clone state lives on user_profiles because a voice is per-agent, not per-listing.
--
-- Storage: a new private 'voiceovers' bucket holds finished mp3s and clone
-- enrollment samples. Path convention:
--   {user_id}/{property_id}.mp3       — finished voiceover
--   {user_id}/clone-sample.{ext}      — enrollment audio

-- ── user_profiles: voice-clone state ──

-- Populated by the clone-enrollment worker once ElevenLabs confirms success.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id text;

-- Lifecycle guard so the UI and pipeline can gate on readiness.
-- Voice cloning is staff-driven, not self-serve: the customer toggles
-- "voice clone" on the order form, then our team reaches out to schedule
-- a recording session, captures the sample, and an admin uploads it via
-- POST /api/admin/voice-clone. The status walks through these states:
-- 'none'       — user has never opted in (default)
-- 'requested'  — customer toggled voice clone on an order; team needs to reach out
-- 'scheduled'  — team has booked a recording session with the customer
-- 'recording'  — session is in progress (rarely visible; mostly transient)
-- 'enrolling'  — sample uploaded, waiting for ElevenLabs to process
-- 'ready'      — clone confirmed ready; elevenlabs_voice_id is populated
-- 'failed'     — ElevenLabs returned an error; staff must re-enroll
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_voice_clone_status_check;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS voice_clone_status text NOT NULL DEFAULT 'none';

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_voice_clone_status_check
  CHECK (voice_clone_status IN ('none', 'requested', 'scheduled', 'recording', 'enrolling', 'ready', 'failed'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS voice_clone_created_at timestamptz;

-- Stored as integer cents (12500 = $125.00). Null until the Stripe charge
-- succeeds so we never mark a clone paid before money is collected.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS voice_clone_paid_cents int;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS voice_clone_paid_at timestamptz;

-- Pointer to the uploaded enrollment audio in the voiceovers bucket.
-- Used for support/re-enrollment flows.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS voice_clone_sample_url text;

-- ── properties: voiceover pipeline outputs ──

-- These columns are pipeline-written. The order form writes nothing here;
-- it only writes add_voiceover / add_voice_clone (added in migration 054).

-- The narration text sent to ElevenLabs. Stored for re-run / audit.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_script text;

-- Final rendered mp3 in the voiceovers bucket.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_audio_url text;

-- ElevenLabs voice ID actually used (may be the cloned voice or the
-- account-default fallback voice). Stored for cost reconciliation + QA.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_voice_id_used text;

-- Character count sent to ElevenLabs — drives per-character cost reconciliation.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_chars int;

-- Duration of the rendered audio. Used to trim / pad the assembled video.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_duration_seconds numeric;

-- ── cost_events: widen provider CHECK to include 'elevenlabs' ──
-- Previous list (from migration 053 + 048a):
--   'anthropic','runway','kling','luma','shotstack','openai',
--   'atlas','google','higgsfield','browserbase','apify','gemini','creatomate'
-- Additive only; no existing rows are invalidated.
ALTER TABLE cost_events
  DROP CONSTRAINT IF EXISTS cost_events_provider_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_provider_check
  CHECK (provider IN (
    'anthropic', 'runway', 'kling', 'luma', 'shotstack', 'openai',
    'atlas', 'google', 'higgsfield', 'browserbase', 'apify', 'gemini',
    'creatomate', 'elevenlabs'
  ));

-- ── Storage: voiceovers bucket ──

-- Private bucket — voiceover audio is billed content; never public by default.
INSERT INTO storage.buckets (id, name, public)
VALUES ('voiceovers', 'voiceovers', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may upload to their own path prefix.
-- Path convention enforced by policy: first folder segment must be auth.uid().
CREATE POLICY "Users can upload own voiceovers"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'voiceovers' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users may read (download) their own files.
CREATE POLICY "Users can read own voiceovers"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'voiceovers' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
