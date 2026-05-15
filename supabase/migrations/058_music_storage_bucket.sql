-- 057: Public storage bucket for music tracks.
-- MP3s must be served via public URL (not signed) so Creatomate can fetch
-- them in rendered videos that may be replayed months later.

INSERT INTO storage.buckets (id, name, public)
VALUES ('music', 'music', true)
ON CONFLICT (id) DO NOTHING;

-- Public read — anyone (including Creatomate) can fetch the audio file.
CREATE POLICY "Anyone can view music"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'music');

-- Only admins can upload new tracks.
CREATE POLICY "Admins can upload music"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'music' AND
    EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Only admins can update (overwrite) existing tracks.
CREATE POLICY "Admins can update music"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'music' AND
    EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    bucket_id = 'music' AND
    EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Only admins can delete storage objects (though we soft-delete rows, so this
-- is a safety backstop, not the normal flow).
CREATE POLICY "Admins can delete music"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'music' AND
    EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin')
  );
