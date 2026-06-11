# Team Lessons — Listing Elevate

Mistakes caught by the gates, recorded per run for future reference. Sorted newest first; keep only the 30 most recent.

## Lessons

**2026-06-11T23:32 (feat/auth-animation-fix):** Branch hygiene on shared checkout — Always cut feature branches from `origin/main` (fetch first, check merge-base), never from the current HEAD if it's on an unrelated feature branch. This run's worktree was set up cleanly from origin/main HEAD, avoiding the re-entrancy issue that would have caused a Prompt Lab merge into an operator-studio branch.

**2026-06-11T23:32 (feat/auth-animation-fix):** Animation synchronization — `autoFocus` on inputs fires *before* `setTimeout` and lifecycle effects, mid-animation. When a child element is focused synchronously during a parent's `framer-motion` y-translate, the browser's "scroll-to-focus" behavior competes with the transform, causing visible jank. Solution: remove autoFocus, defer `.focus()` via `useEffect(..., [ENTRY_MS])` timed to after the animation completes. Apply same pattern for any animation + autofocus interaction.

**2026-06-11T23:32 (feat/auth-animation-fix):** Conditional field mounting without transition — Wrapping a conditional form field (e.g., `{mode === "password" && <div>`) in nothing causes the mount/unmount to snap the card height instantly, destroying fluidity. Solution: wrap the conditional in `<AnimatePresence initial={false}>` + `<motion.div initial={opacity:0,height:0} animate={opacity:1,height:auto} exit={opacity:0,height:0}>` with a 220ms transition. Learned this run fixing the password field toggle.

**2026-06-11T23:32 (feat/auth-animation-fix):** State swap without transition — Ternary content swaps (e.g., `{sent ? <A /> : <B />}`) with no motion wrapper cause instant flips. Solution: wrap both branches in `<AnimatePresence mode="wait" initial={false}>` + `<motion.div key>` per branch (sent-state / form-state) with matching opacity/y transitions on enter/exit. The `mode="wait"` ensures exit completes before enter starts, preventing overlap.

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
