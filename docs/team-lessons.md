# Team lessons — debugging & shipping

Lessons learned and gates that caught them in this repo. Keep recent ones; prune oldest beyond 30 lines.

## Gate-caught mistakes (most recent first)

2026-06-12: safety gate caught P0 missing RLS on preview_view_events — never ship tables without ALTER TABLE ... ENABLE ROW LEVEL SECURITY before applying migrations; the Supabase default (no explicit REVOKE) opens anon PostgREST access to all columns of any table without RLS
2026-06-12: verify gate caught P1 embed TopNav chrome rendering — App.tsx renders TopNav globally above Routes; embed route needs explicit suppression regex guard; add it immediately after the /upload check for consistency
2026-06-12: verify gate caught P1 GET /api/admin/studio/videos/[id] 500 pre-migration-084 — always guard new SELECT columns with 42703 error fallback before applying any migration that adds columns; use the fetchPreviewMeta pattern (try, catch 42703, retry without new cols)
2026-06-12: verify gate caught P1 PATCH preview-links/[previewId] 500 pre-migration-084 on capability-only toggles — never unconditionally include new columns in SELECT/RETURNING clauses when only some endpoint callers need them; build RETURNING dynamically based on request body
2026-06-11: migration-safe back-compat window — pre-migration code path (code deployed, migration NOT applied) must be rock-solid: 204 on beacon insert errors, null defaults on reads, no column requests PostgREST can't satisfy; test both together (capability-only PATCH + 42703 failure cases)
