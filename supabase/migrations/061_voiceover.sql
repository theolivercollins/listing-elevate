-- 061_voiceover.sql
-- Add AI voiceover fields to properties + create voiceovers storage bucket.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS voiceover_url text,
  ADD COLUMN IF NOT EXISTS voiceover_script text,
  ADD COLUMN IF NOT EXISTS voiceover_voice_id text,
  ADD COLUMN IF NOT EXISTS voiceover_compass_url text;

-- Public storage bucket for generated MP3s.
-- Service role handles all writes; public read for audio playback.
INSERT INTO storage.buckets (id, name, public)
VALUES ('voiceovers', 'voiceovers', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Allow authenticated users to upload their own voiceover files.
CREATE POLICY IF NOT EXISTS "voiceovers_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'voiceovers');

-- Public read for audio playback (no auth required for <audio> tags).
CREATE POLICY IF NOT EXISTS "voiceovers_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voiceovers');
