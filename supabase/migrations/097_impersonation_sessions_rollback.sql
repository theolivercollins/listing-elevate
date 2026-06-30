-- 097_impersonation_sessions_rollback.sql
-- Down-migration for 097_impersonation_sessions.sql
-- Drops the impersonation_sessions table (and its indexes/constraints via CASCADE-free DROP).

drop table if exists impersonation_sessions;
