# Responsive Overhaul — Implementation Plan (2026-06-08)

**Goal:** Make the entire Listing Elevate front-end (public marketing site) and owner studio / dashboard fully responsive and dynamic across mobile, tablet, and desktop.

**Architecture:** A central shared foundation (breakpoint standard + responsive utility class library + mobile nav drawer + `useMediaQuery` hook) is built first. Then page-level work is fanned out to parallel subagents that ONLY add utility classes / clamp values to their own `.tsx` files — they never edit shared CSS, so there are no collisions.

## Breakpoint standard (desktop-first max-width, matches existing code)

- **Tablet:** `@media (max-width: 1024px)` — sidebar → drawer, 4-col → 2-col, two-pane → stack
- **Mobile:** `@media (max-width: 640px)` — everything → single column, reduced padding

## Foundation (built centrally — owns ALL global CSS + nav shell)

- `src/styles/responsive.css` (NEW) — utility classes via `!important` breakpoint overrides so existing inline desktop grids stay untouched; agents only ADD a className.
  - Grid collapsers: `.le-cols-2-lg`, `.le-cols-3-lg`, `.le-stack-lg` (→1col ≤1024); `.le-cols-2-sm`, `.le-cols-3-sm`, `.le-stack-sm` (→1col ≤640)
  - `.le-table-scroll` — horizontal-scroll wrapper for fixed-column data tables
  - `.le-flexcol-sm` — flex row → column ≤640
  - `.le-hide-sm` / `.le-show-sm`, media `max-width:100%` guards
- `src/hooks/use-mobile.tsx` — add generic `useMediaQuery(query)` (keep existing `useIsMobile`)
- `src/v2/styles/tokens.css` — dashboard sidebar becomes a slide-in **drawer** ≤1024px (was `display:none` = no nav at all); responsive `.le-main-scroll` padding; new `.le-dash-mobilebar` (hamburger) + `.le-dash-backdrop`
- `src/pages/Dashboard.tsx` — drawer state, mobile top bar with hamburger, backdrop, close-on-route-change; pass `collapsed={false}` to sidebar when in drawer mode
- `src/styles/studio-design.css` — responsive `.studio-main` padding + `.studio-segmented` wrap
- `src/v3/styles/glass.css` — media queries for `.g-upload-layout` (340px rail stacks), `.g-step-rail`, `.g-form-grid`, `.g-card-grid-*`, `.g-voice-grid`
- `src/main.tsx` — import `responsive.css` last (global, wins cascade)

## Fan-out (parallel subagents, disjoint file ownership — `.tsx` only)

- **Agent L — Landing:** `src/v2/components/landing/*` + `src/v2/pages/Landing.tsx`. Replace fixed inline padding (`140px 48px`, `height:574`) with `clamp()`; collapse inline grids via `useMediaQuery` or utility classes; stack CTA button rows; wrap footer links.
- **Agent ST — Studio:** `src/pages/dashboard/studio/*.tsx` + `src/components/studio/share/*.tsx`. Add grid-collapser classes to KPI/kanban/form/photo grids; wrap data tables in `.le-table-scroll`; stack the CreativeSettingsPanel drawer.
- **Agent D — Dashboard:** `src/pages/dashboard/{Overview,Pipeline,Properties,PropertyDetail,Finances,Logs}.tsx`. Wrap all multi-column data tables in `.le-table-scroll` (min-width); collapse KPI + two-pane grids.

## Verify

- `tsc --noEmit` clean, targeted tests pass, build succeeds.
- Manual viewport check at 375 / 768 / 1024 via preview before merge to main (Oliver gates the merge).
