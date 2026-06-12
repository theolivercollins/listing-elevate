# Phase 2 Visual Overhaul — Session Note
**Date:** 2026-06-12  
**Branch:** `feat/authed-app-visual-overhaul`  
**Commit:** 27ae464

## What this session did

Implemented Phase 2 of the authed-app visual overhaul on `feat/authed-app-visual-overhaul`. Phase 1 (role-split IA, shells, honest-data primitives) was already on main (`f47c84b`). This session is the visual/experience layer on top.

## Files changed

### `src/v2/styles/tokens.css`
Updated `.le-dash-shell` color tokens to the approved phase 2 palette:
- Ink: `#0c0e16` (cooler, replacing warmer `#0b0b10`)
- Background: `#f4f5f8` (calmer neutrals)
- New tokens: `--surface-2`, `--accent-soft`, `--accent-2`, `--accent-ink`, `--good-soft`, `--warn-soft`, `--bad-soft`, `--info`, `--info-soft`, `--shimmer-a`, `--shimmer-b`
- New radius tokens: `--radius-md: 14px`, `--radius-xs: 8px`
- Sidebar: frosted `linear-gradient` background + `backdrop-filter: blur(20px) saturate(140%)`
- Active nav item: `::before` pseudo-element — 3px `var(--accent)` spine on left edge
- Top bar: frosted glass, dark mode override
- `.le-page-h1`: 56px → 42px inside `.le-dash-shell` (approved sample authority; marketing site `h1` at 56px is outside this scope, unaffected)
- `.le-card` / `.le-kpi-card`: border added (`1px solid var(--line)`)
- New `.le-kpi-ico` slot class
- New `@keyframes le-dash-shimmer` + `.le-skeleton` / `.le-skeleton-row` CSS classes
- New `.le-triage-strip` + sub-classes
- New `.le-ledger` + `.le-mini-progress` classes
- Mobile breakpoints updated for new h1 sizes

### `src/components/dashboard/primitives.tsx`
- `EmptyState`: phase 2 — 54px icon box with `var(--accent-soft)` background, 15px/600 title
- New `Skeleton` component (`.le-skeleton` class, aria-hidden, configurable width/height/borderRadius)
- New `SkeletonRow` component (`.le-skeleton-row` class — thumb + 2 text lines + badge)

### Pages
- **`AgentHome.tsx`**: added `SkeletonRow` import; loading state now shows 3 skeleton rows instead of blank page
- **`Overview.tsx`**: spinner replaced with 4-tile KPI skeleton grid + chart/ring card skeleton rows
- **`Pipeline.tsx`**: spinner replaced with skeleton; removed hardcoded inline style constants (`ghostBtn`, `primaryAction`, `secondaryAction`, `ghostAction`) that had raw `borderRadius: 10`; replaced button usages with `.le-btn-ghost` / `.le-btn-dark` CSS classes; dropped unused `CSSProperties` import
- **`Properties.tsx`**: "Loading…" text replaced with 4-tile KPI skeleton grid + 6 table skeleton rows

## Gates

- TypeScript: `npx tsc --noEmit` — 0 errors
- Tests: `npx vitest run --maxWorkers=2` — 1,673 passed / 2 skipped (0 failures)
- Build: `pnpm build` — exits 0
- CI gates verified: ORDER_STATUS_MAP exhaustive coverage (7/7), tokens test (2/2)
- DESIGN-GUIDE §9 checklist: all 9 items pass

## Two-language discipline

L1 (marketing/auth) and L2 (authed app shell) remain separate. All token additions are scoped inside `.le-dash-shell {}` or `.dark .le-dash-shell {}`. The global `:root` block is untouched. The L1 `.le-page-h1` (56px on marketing pages) is unaffected because the phase 2 override is scoped inside `.le-dash-shell`.

## What's NOT done (known debt)

Per DESIGN-GUIDE §11, `Properties.tsx`, `Finances.tsx`, `Settings.tsx` still contain ~80 hardcoded `borderRadius: <number>` values. This was pre-existing debt before this session. We fixed Pipeline's button constants (the new ones we would have added). The remaining debt is tracked in §11 and should be fixed opportunistically when touching those files.

## Verify-gate fixes (appended 2026-06-12)

Three findings from the verify gate were resolved in a follow-up commit:

### P0 — committed working-tree files (Pipeline.tsx + Overview.tsx)
The ledger-ruled Pipeline view and the `.le-triage-*` Overview refactor existed only in the working tree after 27ae464 — the Finish step didn't run. Both files were committed as part of this fix commit so the preview branch HEAD matches what typecheck/build verified.

### P2 — urgent vs routine triage color distinction restored
`NeedsYouStrip` items with `urgent: true` now receive the `.is-urgent` modifier class on `.le-triage-item`, which swaps the count badge to `var(--bad)` / `var(--bad-soft)` and adds a subtle red border — matching the approved `02-operator-pipeline.html` `.triage-card.bad` treatment. Routine review items retain the `var(--warn)` palette.

CSS added to `tokens.css`:
- `.le-triage-item.is-urgent` — subtle `var(--bad)` border
- `.le-triage-item.is-urgent .le-triage-count` — `var(--bad-soft)` background, `var(--bad)` text

### INFO — all gates re-confirmed green after fixes
TypeScript clean, 1,673 tests pass, build succeeds.

## Sync to main (2026-06-12, post T1 merge)

**Orchestrator task:** T1 merged origin/main into feat/authed-app-visual-overhaul (commit cc04a0f, `--no-ff`), bringing the branch up to date with all features that landed on main while phase-2 was isolated.

**Main had advanced:** from 114add2 → 224e0f90 (112 commits ahead), incorporating:
1. **Ambient marketing animation layer** (worktree-ui-refresh-light-saas, merge 169898f): Ambient.tsx + AccentDot.tsx + --le-brand-blue-rgb global token + 5 CSS keyframes (le-drift, le-drift-2, le-dot-drift, le-pulse-soft, le-float-gentle) + prefers-reduced-motion backfills + Section ambient prop
2. **LE Video v2 library management** (feat/le-video-library, PR #113): video_folders + video_library_meta tables, folder rail + card menu UI, migration 086 (file-only), 66 tests
3. **Assembly max-quality + Bunny Stream video hosting** (fix/max-quality-assembly, PR #112): Creatomate supersampling 2880x1620, 16:9 source crop, sticky-provider; ALL video hosting moved off Supabase Storage to Bunny Stream (library 679131); migrations 084_scenes_provider_preference + 085_cost_events_bunny applied to prod
4. **Market Update workflow** (merged 3a7a473 + 0cf1c3b): per-region Stellar PDF → validated drafts via Sierra/Sendy
5. **WS7 grammar sweep + run-detail route restore** (f47c84b + eb5aa0c in src/AppRoutes.tsx)

**Reconciliation:**

- **src/v2/styles/tokens.css:** Auto-merged as a clean union. Ambient's global --le-brand-blue-rgb token (line ~70) coexists alongside phase-2's .le-dash-shell{} scoped tokens (cooler ink #0c0e16, refined neutrals, --surface-2, --accent-soft/-2/-ink, --good/warn/bad-soft, --info/-soft, --shimmer-a/b, --radius-md/-xs, skeleton/triage/ledger/mini-progress classes, frosted sidebar/topbar). No hand-editing required; both design languages remain separated.
- **docs/HANDOFF.md:** Manual union resolution—"Last updated:" lines merged newest-first (phase-2 entry first), "Right now" block reordered phase-2 → WS7 → LE Video entry; subsequent entry bodies auto-merged cleanly.
- **All other files** (api/*, lib/*, src/*, supabase/migrations/*): Auto-merged without mutation or regression.

**Design-language separation verified:**

- Phase-2 dashboard cooler ink (#0c0e16) + all .le-dash-shell{} scoped tokens remain inside that selector — zero bleed into L1 marketing
- Ambient marketing layer (--le-brand-blue-rgb, keyframes, Section ambient prop) remains global/marketing-scoped — zero bleed into L2 dashboard

**Test gates (T2 verify, post-merge):**

- **TypeScript:** `tsc --noEmit` → 0 errors
- **Build:** `vite build` → exit 0
- **Unit tests:** Full UNION suite passed (phase-2 tests + main's new tests from LE Video, Market Update, Bunny Stream). Targeted gates all green:
  - tokens.test.ts: PASS
  - ambient.test.ts: PASS
  - LE Video (66 tests): PASS
  - ORDER_STATUS_MAP exhaustive coverage: PASS
  - agent-nav-zero-operator-routes: PASS
  - Market Update + Bunny Stream + delivery tests: PASS
- **Cost integrity:** MoneyValue displays intact; no sample numbers; $0/0/— empty states preserved
- **Design rules:** No monospace (Inter only); both design languages intact; DESIGN-GUIDE §9 checklist passes
- **Marketing regression:** No L1 landing motion regression; ambient layer animates correctly
- **Branch state:** All auto-merged code byte-for-byte identical to source commits; no mutations

**Summary:** Branch now contains all of main 224e0f90 PLUS all 4 phase-2 visual commits. Every recently-landed feature present and functional. Design languages intact and separated. All gates green. Ready for final feat→main merge by the orchestrator.

**Rollback path** (if needed):
```bash
git reset --hard 5d3f751  # Pre-merge phase-2 isolation tip (4 commits only)
```
No migrations created by the merge; no down-migration needed.

## Rollback (pre-merge isolation fix)

`git revert <fix-commit-sha>` then `git revert 27ae464`. No schema changes, no env vars, no API changes. CSS and TSX only.

## Sync to main (2026-06-12, post T1 merge)

**Orchestrator task:** T1 merged origin/main into feat/authed-app-visual-overhaul (commit cc04a0f, `--no-ff`), bringing the branch up to date with all features that landed on main while phase-2 was isolated.

**Main had advanced:** from 114add2 → 224e0f90 (112 commits ahead), incorporating:
1. **Ambient marketing animation layer** (worktree-ui-refresh-light-saas, merge 169898f): Ambient.tsx + AccentDot.tsx + --le-brand-blue-rgb global token + 5 CSS keyframes (le-drift, le-drift-2, le-dot-drift, le-pulse-soft, le-float-gentle) + prefers-reduced-motion backfills + Section ambient prop
2. **LE Video v2 library management** (feat/le-video-library, PR #113): video_folders + video_library_meta tables, folder rail + card menu UI, migration 086 (file-only), 66 tests
3. **Assembly max-quality + Bunny Stream video hosting** (fix/max-quality-assembly, PR #112): Creatomate supersampling 2880x1620, 16:9 source crop, sticky-provider; ALL video hosting moved off Supabase Storage to Bunny Stream (library 679131); migrations 084_scenes_provider_preference + 085_cost_events_bunny applied to prod
4. **Market Update workflow** (merged 3a7a473 + 0cf1c3b): per-region Stellar PDF → validated drafts via Sierra/Sendy
5. **WS7 grammar sweep + run-detail route restore** (f47c84b + eb5aa0c in src/AppRoutes.tsx)

**Reconciliation:**

- **src/v2/styles/tokens.css:** Auto-merged as a clean union. Ambient's global --le-brand-blue-rgb token (line ~70) coexists alongside phase-2's .le-dash-shell{} scoped tokens (cooler ink #0c0e16, refined neutrals, --surface-2, --accent-soft/-2/-ink, --good/warn/bad-soft, --info/-soft, --shimmer-a/b, --radius-md/-xs, skeleton/triage/ledger/mini-progress classes, frosted sidebar/topbar). No hand-editing required; both design languages remain separated.
- **docs/HANDOFF.md:** Manual union resolution—"Last updated:" lines merged newest-first (phase-2 entry first), "Right now" block reordered phase-2 → WS7 → LE Video entry; subsequent entry bodies auto-merged cleanly.
- **All other files** (api/*, lib/*, src/*, supabase/migrations/*): Auto-merged without mutation or regression.

**Design-language separation verified:**

- Phase-2 dashboard cooler ink (#0c0e16) + all .le-dash-shell{} scoped tokens remain inside that selector — zero bleed into L1 marketing
- Ambient marketing layer (--le-brand-blue-rgb, keyframes, Section ambient prop) remains global/marketing-scoped — zero bleed into L2 dashboard

**Test gates (T2 verify, post-merge):**

- **TypeScript:** `tsc --noEmit` → 0 errors
- **Build:** `vite build` → exit 0
- **Unit tests:** Full UNION suite passed (phase-2 tests + main's new tests from LE Video, Market Update, Bunny Stream). Targeted gates all green:
  - tokens.test.ts: PASS
  - ambient.test.ts: PASS
  - LE Video (66 tests): PASS
  - ORDER_STATUS_MAP exhaustive coverage: PASS
  - agent-nav-zero-operator-routes: PASS
  - Market Update + Bunny Stream + delivery tests: PASS
- **Cost integrity:** MoneyValue displays intact; no sample numbers; $0/0/— empty states preserved
- **Design rules:** No monospace (Inter only); both design languages intact; DESIGN-GUIDE §9 checklist passes
- **Marketing regression:** No L1 landing motion regression; ambient layer animates correctly
- **Branch state:** All auto-merged code byte-for-byte identical to source commits; no mutations

**Summary:** Branch now contains all of main 224e0f90 PLUS all 4 phase-2 visual commits. Every recently-landed feature present and functional. Design languages intact and separated. All gates green. Ready for final feat→main merge by the orchestrator.

**Rollback path** (if needed):
```bash
git reset --hard 5d3f751  # Pre-merge phase-2 isolation tip (4 commits only)
```
No migrations created by the merge; no down-migration needed.
