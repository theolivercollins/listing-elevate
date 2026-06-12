-- 077_creatives_bunny.sql
-- Bunny Stream migration for Share-tab creatives. Uploaded creatives now live in
-- Bunny Stream (cheaper delivery, HLS, real player) instead of the Supabase
-- `creatives` bucket. We store Bunny's video GUID here; the Supabase render path
-- (source='render', public_url) is unchanged, as is the legacy upload path.
alter table creatives add column if not exists bunny_video_id text;

comment on column creatives.bunny_video_id is
  'Bunny Stream video GUID for uploads hosted on Bunny (library 679131). Null for Supabase-bucket uploads and property renders.';
