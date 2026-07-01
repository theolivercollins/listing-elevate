-- 102_video_hls_poster.sql
-- Adaptive HLS playback + real poster frames for delivered listing videos.
--
-- Today properties.horizontal_video_url / vertical_video_url hold Bunny's
-- PROGRESSIVE mp4 (bunnyMp4Url) and the player shows a blank box that "gradually
-- loads". Bunny Stream already produces an adaptive HLS playlist (bunnyHlsUrl →
-- .../{guid}/playlist.m3u8) and a per-encode poster (bunnyThumbnailUrl →
-- .../{guid}/thumbnail.jpg) for the SAME upload — both were built but unused.
--
-- This migration adds four nullable columns so lib/assembly/finalize.ts can
-- persist those Bunny URLs alongside the existing mp4 for NEW renders. Players
-- (Studio CheckpointB via HlsPlayer, the public LEPlayer, PropertyCommandCenter)
-- prefer *_hls_url when present and use *_poster_url as the poster frame, else
-- fall back to *_video_url (the mp4) + a hero photo.
--
-- Why full URLs, not a single *_bunny_guid: the browser has no access to
-- BUNNY_STREAM_CDN_HOSTNAME (a server-only env), so it cannot derive
-- playlist.m3u8 / thumbnail.jpg from a bare guid without a new public env var.
-- Persisting the finished URLs keeps consumers dumb (read a string, pass it to
-- the player) and needs no new client config.
--
-- ADDITIVE + SAFE:
--   * add column if not exists — re-runnable, no error if already present.
--   * All four columns are nullable with NO default and NO backfill. Every
--     existing (legacy) row keeps *_hls_url = *_poster_url = NULL, and the
--     players fall back to the mp4 + hero photo, so existing mp4-only rows keep
--     working unchanged. Only renders finalized AFTER this ships populate them.
--   * text (matches horizontal_video_url / vertical_video_url exactly).
--
-- No RLS change: these columns live on the existing `properties` table and
-- inherit its policies. `properties` is already exposed to readers that see
-- *_video_url; *_hls_url / *_poster_url are the same class of public playback
-- URL, so no new grant/policy is required.
--
-- Down-migration (rollback): see 102_video_hls_poster_rollback.sql
--   drops the four columns.

alter table properties add column if not exists horizontal_hls_url    text;
alter table properties add column if not exists horizontal_poster_url text;
alter table properties add column if not exists vertical_hls_url      text;
alter table properties add column if not exists vertical_poster_url   text;

comment on column properties.horizontal_hls_url is
  'Bunny Stream adaptive HLS playlist URL for the 16:9 render (playlist.m3u8). Preferred over horizontal_video_url (progressive mp4) by the players. NULL for legacy mp4-only rows and any render whose Bunny host failed/was skipped.';
comment on column properties.horizontal_poster_url is
  'Bunny per-encode poster/thumbnail URL for the 16:9 render (thumbnail.jpg). Used as the <video> poster; consumers fall back to a hero photo when NULL.';
comment on column properties.vertical_hls_url is
  'Bunny Stream adaptive HLS playlist URL for the 9:16 render (playlist.m3u8). Preferred over vertical_video_url (progressive mp4) by the players. NULL for legacy mp4-only rows and any render whose Bunny host failed/was skipped.';
comment on column properties.vertical_poster_url is
  'Bunny per-encode poster/thumbnail URL for the 9:16 render (thumbnail.jpg). Used as the <video> poster; consumers fall back to a hero photo when NULL.';
