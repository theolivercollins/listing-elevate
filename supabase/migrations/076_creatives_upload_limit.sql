-- 076_creatives_upload_limit.sql
-- Raise the `creatives` storage bucket per-object size limit to 500 MB so it
-- matches the Share-tab uploader ("up to 500 MB"). The bucket was created with
-- file_size_limit = NULL, which falls back to the project-wide global limit.
--
-- IMPORTANT: the effective per-upload cap is min(bucket_limit, project_global).
-- The project global storage limit must ALSO be >= 500 MB (raised via the
-- Supabase Management API / dashboard Storage settings) for >50 MB uploads to
-- actually succeed — setting the bucket alone is necessary but not sufficient.
update storage.buckets
set file_size_limit = 524288000  -- 500 MB in bytes
where id = 'creatives';
