-- 101_studio_drafts_rollback.sql
-- Down-migration for 101_studio_drafts.sql
-- Drops the studio_drafts table. RLS enablement, the index, and the
-- anon/authenticated revoke all live on the table itself, so DROP TABLE
-- removes all of it in one step (no policy or grant to unwind).

drop table if exists studio_drafts;
