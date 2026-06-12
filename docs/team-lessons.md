# Team lessons — debugging & shipping

Lessons learned and gates that caught them in this repo. Keep recent ones; prune oldest beyond 30 lines.

## Gate-caught mistakes (most recent first)

2026-06-12: safety gate caught P0 missing RLS on preview_view_events — never ship tables without ALTER TABLE ... ENABLE ROW LEVEL SECURITY before applying migrations; the Supabase default (no explicit REVOKE) opens anon PostgREST access to all columns of any table without RLS
2026-06-12: verify gate caught P1 embed TopNav chrome rendering — App.tsx renders TopNav globally above Routes; embed route needs explicit suppression regex guard; add it immediately after the /upload check for consistency
2026-06-12: verify gate caught P1 GET /api/admin/studio/videos/[id] 500 pre-migration-084 — always guard new SELECT columns with 42703 error fallback before applying any migration that adds columns; use the fetchPreviewMeta pattern (try, catch 42703, retry without new cols)
2026-06-12: verify gate caught P1 PATCH preview-links/[previewId] 500 pre-migration-084 on capability-only toggles — never unconditionally include new columns in SELECT/RETURNING clauses when only some endpoint callers need them; build RETURNING dynamically based on request body
2026-06-11: migration-safe back-compat window — pre-migration code path (code deployed, migration NOT applied) must be rock-solid: 204 on beacon insert errors, null defaults on reads, no column requests PostgREST can't satisfy; test both together (capability-only PATCH + 42703 failure cases)
2026-06-11 (feat/auth-animation-fix): Branch hygiene on shared checkout — always cut feature branches from origin/main (fetch first, check merge-base), never from the current HEAD if it's on an unrelated feature branch; a worktree set up cleanly from origin/main HEAD avoids the re-entrancy issue that would otherwise merge an unrelated feature into the new branch
2026-06-11 (feat/auth-animation-fix): Animation synchronization — autoFocus on inputs fires before setTimeout and lifecycle effects, mid-animation; focusing a child synchronously during a parent framer-motion y-translate makes the browser's scroll-to-focus compete with the transform (visible jank); remove autoFocus, defer .focus() via useEffect timed to after the animation (ENTRY_MS)
2026-06-11 (feat/auth-animation-fix): Conditional field mounting without transition — wrapping a conditional form field in nothing snaps the card height on mount/unmount; wrap in AnimatePresence initial={false} + motion.div (opacity/height 0→auto) with a ~220ms transition
2026-06-11 (feat/auth-animation-fix): State swap without transition — ternary content swaps with no motion wrapper flip instantly; wrap both branches in AnimatePresence mode="wait" initial={false} + motion.div key per branch with matching opacity/y enter/exit; mode="wait" ensures exit completes before enter starts
