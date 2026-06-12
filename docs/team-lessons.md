# Team Lessons — Listing Elevate

Mistakes caught by the gates, recorded per run for future reference. Sorted newest first; keep only the 30 most recent.

## Lessons

**2026-06-12: semantic security conflict on api/properties/index.ts — merge conflict resolution kept both auth gates aligned.** Branch added P0 requireAuth + tenant scoping (non-admins limited to submitted_by=user.id) to GET /api/properties; main independently evolved the file. Merged resolution kept main's structure AND the branch's auth gate + tenant scope; verified the merged handler rejects unauthenticated requests (401) and scopes non-admins correctly. Security property: both before and after the branch commit, the endpoint enforced the same gate; merging preserves strictness.

**2026-06-12: verify gate caught P0 missing RLS on preview_view_events — never ship tables without ALTER TABLE ... ENABLE ROW LEVEL SECURITY before applying migrations; the Supabase default (no explicit REVOKE) opens anon PostgREST access to all columns of any table without RLS.**

**2026-06-12: verify gate caught P1 embed TopNav chrome rendering — App.tsx renders TopNav globally above Routes; embed route needs explicit suppression regex guard; add it immediately after the /upload check for consistency.**

**2026-06-12: verify gate caught P1 GET /api/admin/studio/videos/[id] 500 pre-migration-084 — always guard new SELECT columns with 42703 error fallback before applying any migration that adds columns; use the fetchPreviewMeta pattern (try, catch 42703, retry without new cols).**

**2026-06-12: verify gate caught P1 PATCH preview-links/[previewId] 500 pre-migration-084 on capability-only toggles — never unconditionally include new columns in SELECT/RETURNING clauses when only some endpoint callers need them; build RETURNING dynamically based on request body.**

**2026-06-11: migration-safe back-compat window — pre-migration code path (code deployed, migration NOT applied) must be rock-solid: 204 on beacon insert errors, null defaults on reads, no column requests PostgREST can't satisfy; test both together (capability-only PATCH + 42703 failure cases).**

**2026-06-11 (feat/auth-animation-fix): Branch hygiene on shared checkout — always cut feature branches from origin/main (fetch first, check merge-base), never from the current HEAD if it's on an unrelated feature branch. This run's worktree was set up cleanly from origin/main HEAD, avoiding the re-entrancy issue that would have caused a Prompt Lab merge into an operator-studio branch.**

**2026-06-11 (feat/auth-animation-fix): Animation synchronization — autoFocus on inputs fires before setTimeout and lifecycle effects, mid-animation. When a child element is focused synchronously during a parent's framer-motion y-translate, the browser's "scroll to focused element" competes with the transform, causing visible jank. Solution: remove autoFocus, defer .focus() via useEffect timed to after the animation completes. Apply same pattern for any animation + autofocus interaction.**

**2026-06-11 (feat/auth-animation-fix): Conditional field mounting without transition — Wrapping a conditional form field in nothing causes the mount/unmount to snap the card height instantly, destroying fluidity. Solution: wrap the conditional in AnimatePresence initial={false} + motion.div (initial opacity/height 0→auto exit) with a 220ms transition. Learned this run fixing the password field toggle.**

**2026-06-11 (feat/auth-animation-fix): State swap without transition — Ternary content swaps with no motion wrapper cause instant flips. Solution: wrap both branches in AnimatePresence mode="wait" initial={false} + motion.div key per branch (sent-state / form-state) with matching opacity/y enter/exit transitions. The mode="wait" ensures exit completes before enter starts, preventing overlap.**

**2026-06-11 (feat/market-update-workflow): branch reverted main's test fixes (stale-base test files).** Two test files were edited from a stale base and silently undid fixes that already existed on origin/main: `api/admin/studio/__tests__/ingest.test.ts` (vi.mock pattern lost the importOriginal, dropping stringifyDbError export); `src/v2/components/landing/MarketComparison.test.tsx` (reverted to stale getByText, re-added dead assertion). **Lesson:** before editing a test file on a feature branch, diff it against origin/main (`git diff origin/main -- <file>`). If the branch's copy is older, restore main's version and apply your change on top — never re-type from memory. Production code correct in both; only tests were stale.
