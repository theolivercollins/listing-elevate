# WS6 — Re-shell /upload into the L2 dashboard app-shell

Date: 2026-06-12
Branch: `feat/authed-app-role-split`
Scope: chrome-only re-frame of the `/upload` order wizard. The live revenue path
(createProperty → Stripe checkout redirect), upload mechanics, MLS lookup,
voiceover preview, and step ordering/validity are **untouched**.

## What changed

`src/pages/Upload.tsx`

- **Before:** `/upload` was a standalone full-page rendering its own marketing
  chrome — `glass-page` + `glass-bg-base` + the v2 marketing `SiteNav`, with
  page-level horizontal padding (`clamp(16px,5vw,36px)` / `36px`).
- **After:** the wizard renders through a new local `ShellFrame` component that
  replicates the L2 dashboard shell (`le-root le-dash-shell` + `DashboardSidebar`
  + `le-dash-main` + mobile hamburger bar + `le-main-scroll`) — the same chrome
  `src/pages/Dashboard.tsx` uses. Page-level horizontal padding removed; the
  shell's `le-main-scroll` now provides the gutter (DESIGN-GUIDE §9). Both the
  wizard render **and** the post-submit success render are wrapped, so the bare
  marketing `glass-page` no longer appears on this route in any state.
- `SiteNav` import removed. Added `DashboardSidebar`/`useDashboardSidebar`,
  `Icon`, `useMediaQuery`, `Menu`, `Link`, and `@/v2/styles/v2.css` (for the
  `le-dash-*` tokens) imports.

### Deliberately NOT done (and why)

- **Route stays standalone** at `/upload` (still inside `<RequireAuth/>`, NOT
  moved under the `<Dashboard>` `<Outlet>`). Moving it would change auth/index
  semantics and sits adjacent to the **public** Stripe redirect targets
  `/upload/success` and `/upload/cancelled` — too much revenue-path risk for a
  chrome pass. The shell is replicated instead.
- **`glass.css` import kept.** The inner step CONTENT (`g-section-card`,
  `g-choice-card`, `g-duration-tile`, `g-order-rail`, the order summary, etc.)
  is the step logic I was told not to touch, and it still depends on glass.css.
  Only the OUTER page wrapper/nav was swapped. The `g-page-heading` and
  `g-step-rail` wizard-chrome classes were left as-is for now — they inherit the
  L2 shell background and converting them to the `PageHeading` primitive carries
  layout risk on this 1834-line revenue file. **Follow-up:** convert
  `g-page-heading` → `PageHeading` and `g-step-rail` → L2 token rail in a
  dedicated low-risk pass, then the glass.css import can be retired once the
  inner step cards are also migrated. `glass.css` the FILE was NOT deleted
  (clean single-revert rollback).

## Tests

New: `src/pages/__tests__/Upload-in-shell.test.tsx` (TDD, written first).
Asserts (1) `.le-dash-shell` present, (2) no `.glass-page`/`.glass-bg-base`,
(3) step-0 Style selectors (package / duration / orientation) still render.
Includes an in-memory `localStorage` stub because the sidebar collapsed-state
hook reads it and happy-dom doesn't provide one in this config.

- `pnpm vitest run --maxWorkers=2 src/pages/__tests__/Upload-in-shell.test.tsx` → 3/3 green
- `pnpm vitest run --maxWorkers=2 src/pages src/components` → 191/191 green (no regressions)
- `pnpm exec tsc --noEmit` → 0 errors

## MANUAL smoke required before promotion (NOT automated)

The full order flow must be clicked through end-to-end before any promote:
**Style → Property → Add-ons → Photos → submit → Stripe checkout redirect.**
The automated test only covers the chrome swap; it deliberately does not exercise
createProperty/Stripe. Flag for Oliver.

## Rollback

Single `git revert <this commit>` restores the standalone glass.css route. No
migrations, no env, no data.
