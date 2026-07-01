-- 102_video_hls_poster_rollback.sql
-- Down-migration for 102_video_hls_poster.sql
-- Drops the four additive HLS/poster columns from properties. `drop column if
-- exists` is idempotent; column comments drop with the column. Any values are
-- discarded (players simply revert to the mp4 + hero-photo fallback), so this is
-- non-destructive to playback — the mp4 in *_video_url is untouched.

alter table properties drop column if exists horizontal_hls_url;
alter table properties drop column if exists horizontal_poster_url;
alter table properties drop column if exists vertical_hls_url;
alter table properties drop column if exists vertical_poster_url;
