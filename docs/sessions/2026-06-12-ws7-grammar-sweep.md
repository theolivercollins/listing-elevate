# WS7 — Bounded grammar sweep session note

**Date:** 2026-06-12  
**Branch:** `feat/ws7-grammar-sweep`  
**Commit:** 5df7424  
**Status:** Complete — all gates green

## What was done

Mechanical convergence of in-scope agent pages and the highest-traffic operator page (Overview) onto the shared primitives kit and Tailwind grammar canon. Bounded sweep per council directive: hard stop at PromptLab / PropertyDetail / Lab / Learning / blog / email.

## Changes per file

### `src/pages/dashboard/AgentHome.tsx`
- Removed ad-hoc `p-6` page-level padding (DESIGN-GUIDE §2 violation — shell provides gutter)
- "Finish checkout" `<Link>` migrated from `style={{ color: "var(--warn)" }}` to `className="le-btn-ghost"`
- "Track" `<Link>` migrated from `style={{ color: "var(--accent)" }}` to `className="le-btn-ghost"`
- Older delivered "Watch" `<a>` migrated from inline color to `className="le-btn-ghost"`

### `src/pages/dashboard/account/Listings.tsx`
- Import: `StatusPill` → `StatusChip`, added `EmptyState`
- `<StatusPill>` → `<StatusChip>` in the table rows
- No-listings empty state: ad-hoc `<div>` with inline text + raw `<Link className="le-btn-dark">` → `<EmptyState message icon cta />` (EmptyState renders le-btn-ghost for CTA)

### `src/pages/dashboard/account/Billing.tsx`
- Import: `StatusPill` → `StatusChip`, added `EmptyState`
- `<StatusPill>` → `<StatusChip>` in the billing rows
- No-billing empty state: ad-hoc `<div>` → `<EmptyState message icon />`

### `src/pages/dashboard/Overview.tsx`
- Import: `StatusPill` removed, `StatusChip` added, `EmptyState` consolidated to single import
- `<StatusPill>` → `<StatusChip>` in the in-production property rows
- In-production empty `<div>` → `<EmptyState message icon="home" />`
- Leaderboard empty `<div>` → `<EmptyState message />`

### `src/pages/dashboard/__tests__/GrammarSweep.test.ts` (new)
- 27 source-level assertions per DESIGN-GUIDE §9 checklist for all 5 in-scope pages
- Written first (TDD) — 5 failing, then all 27 green after changes

## DESIGN-GUIDE §9 checklist per page

| Check | AgentHome | Listings | Billing | Profile | Overview |
|---|---|---|---|---|---|
| PageHeading used | ✓ | ✓ | ✓ | ✓ | ✓ |
| No page-level horizontal padding | ✓ (fixed) | ✓ | ✓ | ✓ | ✓ |
| Radii are tokens | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8px spacing scale | ✓ | ✓ | ✓ | ✓ | ✓ |
| Shadows from `--le-shadow-*` | N/A | N/A | N/A | N/A | N/A |
| Inter only | ✓ | ✓ | ✓ | ✓ | ✓ |
| Colors are tokens | ✓ | ✓ | ✓ | ✓ | ✓ |
| Status via StatusChip | ✓ | ✓ (fixed) | ✓ (fixed) | N/A | ✓ (fixed) |
| Interactive keyboard-reachable | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hover affordances on :focus-within | ✓ (le-btn-ghost) | ✓ | ✓ | ✓ | ✓ |

## Gates

- `pnpm vitest run --maxWorkers=2`: **1387 tests, 0 failures** (154 files)
- `tsc --noEmit`: **0 errors**
- Out-of-scope files diff: **none** (PromptLab / PropertyDetail / Lab / Learning untouched)
- Grep check: no raw `<button` with inline `color`/`background` on in-scope agent pages

## Out-of-scope (explicitly not touched)

PromptLab (291 inline styles), PropertyDetail, Lab/LabListing*, Learning, KnowledgeMap,
blog, email, operator deep-tools. These are operator-only surfaces that work and the
overcomplication test fails for sweeping them in this pass.
