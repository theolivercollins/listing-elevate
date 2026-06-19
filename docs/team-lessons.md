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

## 2026-06-11 — branch reverted main's test fixes (stale-base test files)

On `feat/market-update-workflow`, two test files were edited from a stale base and silently undid fixes that already existed on `origin/main`:

- `api/admin/studio/__tests__/ingest.test.ts` — main's `vi.mock` used the `importOriginal` pattern so the real `stringifyDbError` stayed available to the handler; the branch replaced it with a bare factory exporting only `manualIngest`, so vitest strict mocking threw `No "stringifyDbError" export is defined on the mock` in every test reaching the catch block (4 failures). Main's extra `video_type` passthrough test was also dropped.
- `src/v2/components/landing/MarketComparison.test.tsx` — main used `getAllByText(/Win more listings/i)` (text renders twice) and had removed the stale `The math` assertion (PricingCalculator archived 2026-04-21); the branch reverted to `getByText` + re-added the dead assertion (1 failure).

**Lesson:** before editing a test file on a feature branch, diff it against `origin/main` first (`git diff origin/main -- <file>`). If the branch's copy is older than main's, restore main's version and apply your change on top — never re-type a test from memory of an old checkout. Production code was correct in both cases; only the tests were wrong.

## Tracked pre-existing debt (not regressions — verified present on origin/main)

`tsc -p tsconfig.app.json --noEmit` reports 23 pre-existing errors on main in files untouched by feature branches, including: `src/pages/dashboard/PromptLab.tsx` (missing `SkuChoice` keys `kling-v3-pro` / `seedance-pro-pushin` / `veo-3-1-preview` in cost+label maps; stale `.tier` access), `src/pages/dashboard/Settings.tsx` (4x `Dispatch<SetStateAction<…>>` vs `(v: string) => void`), `src/pages/Upload.tsx` (`sqft` not a known property), plus AddressAutocomplete, EmailDesigner, labModels, Finances, Pipeline, BlogPostsList and 3 test files. Vercel's build does not run tsc, so these don't block deploys — but new errors hide among them. When touching one of these files, fix its errors as part of the change. Note: the root `tsconfig.json` is a solution file (`files: []`) — a bare `tsc --noEmit` checks NOTHING and reports 0 errors; always use `-p tsconfig.app.json` (or `-b`).

## 2026-06-11 — quality fix shipped against the wrong provider, contradicting the diagnosis

The assembly-quality fix (984561a) changed only Shotstack payloads and forced fps:30, while the same-day diagnosis (docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md) had already proven (a) the failing run rendered via **Creatomate** (Shotstack moot), (b) all source clips measure **24fps** (forcing 30 adds the exact resample softness being fixed), and (c) the dominant loss was the direct-Kling 1172x784 sub-1080p clips being cover-upscaled 1.64x. The diagnosis and the fix also landed on two different unmerged branches, so neither told the whole story.

**Lessons:**
- Before fixing a pipeline defect, read the run's actual provider/route from the data (`assembly_provider`, render records) — never fix the fallback provider and call the defect handled.
- If a diagnosis doc exists for the bug, the fix must implement its recommendations or explicitly rebut them; measured numbers (ffprobe fps/resolution) beat assumptions about what AI models "usually" output.
- Frame rate in assembly payloads must FOLLOW the sources (or be omitted), never "upgraded" — resampling 24fps to 25/30 softens motion.
- Diagnosis + fix for one incident belong on ONE branch; cherry-pick the diagnosis commit onto the fix branch before coding.

## 2026-06-11 — adversarial panel refuted the quality fix: unmeasured claim, missed route, contaminated branch

Three catches on the assembly-quality fix, all preventable:

1. **A commit claimed an outcome nobody measured.** The Kling-crop commit asserted the crop makes native Kling "emit 16:9 1080p-class clips, so the assembler no longer upscales." ffprobe of six production clips disproved it: kling-v2-master (native AND Atlas-hosted) has a fixed ~0.92 MP output budget — the exact 1280x720 area — for any input. The test only asserted the crop function was *invoked*, which proves nothing about output resolution. **Lesson:** a claim about provider output geometry goes in a commit only after ffprobing real output (historical clips in Storage are free evidence); a unit test that stubs the transform cannot back a resolution claim.
2. **The fix covered one route of a multi-route defect.** Aspect-copying was fixed on direct-native Kling but every Atlas-routed Kling SKU (incl. paired kling-v3-pro, the hero scene of the diagnosed run) has the same behavior — and the stale "geometry is fixed in-model" comment that caused the blind spot was left in place. **Lesson:** when a defect is "model X ignores parameter Y", enumerate EVERY SKU/route that reaches model X (grep the descriptor table) and either fix or explicitly rule out each one; delete the disproved comment in the same commit, or the next reader inherits the blind spot.
3. **The fix branch was cut from a feature branch, not origin/main.** Basing fix/max-quality-assembly on feat/market-update-workflow dragged 300+ unreviewed market-update lines toward a prod PR, and its stale router.ts (paired -> kling-v2-1-pair, upgraded to kling-v3-pro on main 2026-06-10) made two panel refuters disagree about which SKU paired scenes use. **Lesson:** prod-bound fix branches are cut from origin/main, full stop. `git log --oneline origin/main..HEAD` before the first commit; if commits you didn't write appear, rebase first.

Also recorded: the run under diagnosis degraded because Atlas returned HTTP 402 (insufficient balance) and every v1.1 scene failed over to the 720p-class native Kling. Quality incidents can be ops incidents — check the provider error trail before assuming code.

## Dated gate-catch log (one line per lesson, max 30 most recent)

- 2026-06-18: review claimed a duplicate-scenes money bug that was actually mitigated by the existing runScripting scenes-exist guard (lib/pipeline.ts:668-673) — read the code before trusting a review's risk assessment; guards already in place are not "unfixed" bugs.
- 2026-06-18: verifier trusted a stale HANDOFF note that `CREATOMATE_TEMPLATE_ID_JUST_LISTED_30` was unwired when the live Vercel env had it set (a9f8…30c9) — check live infra (Vercel env vars, Supabase applied migrations) over docs when the two disagree; docs lag, infra is ground truth.
- 2026-06-11: tests gate caught a vi.mock factory missing a newly-imported export (stringifyDbError, 4 failures) — when a handler gains an import, update every mock factory; prefer the importOriginal pattern so real exports survive.
- 2026-06-11: tests gate caught stale-base test files silently reverting origin/main's fixes (ingest.test.ts, MarketComparison.test.tsx) — `git diff origin/main -- <file>` before editing any test on a feature branch; restore main's copy and layer changes on top.
- 2026-06-11: tests gate caught Edit/Write blocked for pinned subagents under the worktree-isolation guard — spawn fixer seats with cwd inside the run worktree (or isolation: worktree) so file edits use the proper tools.
- 2026-06-11: tests gate caught a bare `tsc --noEmit` reporting 0 errors because the root tsconfig is a solution file (`files: []`) — always typecheck with `-p tsconfig.app.json` / `-p tsconfig.api.json`.
- 2026-06-11: qa gate caught the quality fix targeting Shotstack when the failing run rendered via Creatomate — read the run's actual provider route from the data (assembly_provider, render records) before fixing anything.
- 2026-06-11: qa gate caught fps:30 forced onto measured-24fps sources — assembly frame rate must follow the sources or be omitted; "upgrading" fps adds the resample softness being fixed.
- 2026-06-11: qa gate caught the dominant diagnosed root cause (sub-1080p Kling clips cover-upscaled 1.64x) left unfixed while a side path was patched — implement the diagnosis's primary recommendation or explicitly rebut it.
- 2026-06-11: qa gate caught diagnosis and fix split across two unmerged branches — one incident, one branch; cherry-pick the diagnosis commit onto the fix branch before coding.
- 2026-06-11: adversarial panel caught an unmeasured commit claim ("1080p-class clips") disproved by ffprobe (Kling's fixed ~0.92 MP budget) — measure real provider output before claiming geometry; an invocation-stub test cannot back a resolution claim.
- 2026-06-11: adversarial panel caught the fix covering one route of a multi-route defect (direct Kling fixed, Atlas-routed Kling SKUs not) — enumerate every SKU/route reaching the defective model and fix or rule out each; delete disproved comments in the same commit.
- 2026-06-11: adversarial panel caught the prod-bound fix branch cut from a feature branch instead of origin/main (dragged 300+ unrelated lines, stale router confused refuters) — cut prod-bound branches from origin/main, verify with `git log origin/main..HEAD` before the first commit.