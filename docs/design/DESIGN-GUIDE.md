# Listing Elevate — UI Design Guide

**Status: authoritative.** Every new piece of UI — page, component, modal, button — follows this guide. If a rule here conflicts with what you see in older code, this guide wins; fix the old code opportunistically (or flag it) rather than copying it.

Created 2026-06-11 after an audit found two diverging token systems (`src/v2/styles/tokens.css` vs `src/styles/studio-design.css`), 80+ hardcoded radius/padding values, and page headings whose left edge differed between surfaces (the Video Studio pages double-padded their content: `.le-main-scroll` 36px + `.studio-main` 36px = 72px, while blog/email sat at 36px).

## 1. Single source of truth

- **Canonical tokens live in `src/v2/styles/tokens.css`** (`--le-*` on `:root`).
- `src/styles/studio-design.css` is a *scoped skin* (`.studio-scope`) — it may restyle color/background, but its radius, shadow, and spacing tokens must stay **aliased to the canonical values**. Never give a scoped system its own scale.
- Adding a third token file is forbidden. New surfaces consume the canonical tokens.

## 2. Layout & alignment

- The dashboard shell (`src/pages/Dashboard.tsx`) wraps every route in `<main class="le-main-scroll">`, which provides the page gutter: **`padding: 24px 36px 48px`** (responsive: `16px 16px 40px` ≤1024px, `14px 12px 36px` ≤640px).
- **Pages never add their own horizontal page padding.** A page that needs a full-bleed band must explicitly opt out — don't re-pad.
- Every page starts with the **page-heading pattern** so the eyebrow/title/subtitle left edge is identical on every screen:
  - Dashboard surfaces: `<PageHeading eyebrow title sub actions />` from `src/components/dashboard/primitives.tsx`.
  - Studio surfaces: the `.studio-page-heading` block (same geometry: eyebrow 13px, h1 56px/-0.04em/1.02, sub 16px max-width 540px, 32px bottom margin).
  - Do not hand-roll a heading with ad-hoc margins. If a surface needs a new variant, extend the component/class — don't fork the geometry.

## 3. Radius scale (no other values, ever)

| Token | Value | Use |
|---|---|---|
| `--le-r-sm` | 6px | chips, badges, small icon buttons, inputs inside dense rows |
| `--le-r-md` | 10px | buttons, inputs, dropdown items, small cards/thumbnails |
| `--le-r-lg` | 14px | cards, modals, panels |
| `--le-r-xl` | 20px | hero cards, large media frames |
| `--le-r-pill` | 999px | pills, segmented controls, status badges |

In `.studio-scope`: `--le-radius-sm` = 10px (md), `--le-radius` = 14px (lg), `--le-radius-pill` = 999px. These are aliases — change the canonical scale, not the aliases.

**Inline styles:** write `borderRadius: "var(--le-r-md)"`, not `borderRadius: 10`. Never `99` — it reads as pill but isn't the token; use `var(--le-r-pill)`.

## 4. Spacing scale

Use multiples of **4px**: 4, 8, 12, 16, 20, 24, 32, 48. No 7px, 9px, 13px paddings. Two sanctioned exceptions: dense controls (status pills, tiny chips) may use 2–3px vertical padding, and the `8px 14px` / `10px 14px` recipes below are grandfathered as the horizontal rhythm for menu rows and ghost buttons.

Standard recipes:

| Element | Padding |
|---|---|
| Primary / CTA button | `10px 16px` |
| Secondary / ghost button | `8px 14px` |
| Small / tab / pill button | `6px 12px` |
| Icon button | `8px` square |
| Dropdown menu item | `10px 14px` |
| Status pill | `3px 10px` |
| Card | `24px` (compact: `20px`) |
| Modal section header row | `12px 20px` |

## 5. Shadows

Only the three canonical shadows (`--le-shadow-sm/md/lg` in `tokens.css`, warm `rgba(20,18,15,…)` base). The studio skin uses the same values. Don't write one-off `boxShadow` strings except for transient drag/hover affordances.

## 6. Typography

- **Inter only. No monospace UI text — ever** (see CLAUDE.md rule 7; `--le-font-mono` is intentionally aliased to Inter).
- Page title: 56px / 600 / -0.04em / 1.02 (32px ≤1024px, 26px ≤640px — handled by the shared classes).
- Eyebrow: 13px, muted, letter-spacing -0.003em.
- Page subtitle: 16px, muted, 1.5, max-width 540px.
- Section labels in panels: 10px / 700 / uppercase / 0.12em tracking, muted.
- Body/UI text: 12–13px in dense surfaces, 14px default.
- Numbers that align in columns: `fontVariantNumeric: "tabular-nums"` (still Inter).

## 7. Color

- Use semantic tokens (`--le-text`/`--ink`, `--le-text-muted`/`--muted`, `--le-border`/`--line`, accent, success/warn/danger). No new hex values in components; if a color isn't a token, it goes into `tokens.css` first.
- Status pills use the `StatusPill` map in `primitives.tsx` — don't invent per-page status colors.

## 8. Components before markup

Before building UI, reach for the existing primitives (`src/components/dashboard/primitives.tsx`): `PageHeading`, `KpiCard`, `StatusPill`, `Card`, `Sparkline`. If a primitive almost fits, extend it with a prop. Hand-rolled duplicates of an existing primitive are review-blockers.

## 9. New-UI checklist (copy into your PR/plan)

- [ ] Page uses `PageHeading` / `.studio-page-heading` — no custom heading geometry
- [ ] No page-level horizontal padding added (the shell provides the gutter)
- [ ] All radii are tokens from §3 (no raw numbers)
- [ ] All spacing on the 4px scale, button/card paddings from §4 recipes
- [ ] Shadows are `--le-shadow-*` only
- [ ] Inter everywhere; no monospace; tabular-nums for aligned numbers
- [ ] Colors are tokens; status colors via `StatusPill`
- [ ] Interactive elements keyboard-reachable (focusable, visible focus ring, Enter/Space/Arrows where appropriate)
- [ ] Hover-only affordances also appear on `:focus-within` (touch + keyboard users)

## 10. Known debt (fix opportunistically)

- ~80 hardcoded `borderRadius: <number>` / odd paddings across `EmailsList.tsx`, `BlogPostsList.tsx`, `Settings.tsx`, `Properties.tsx`, PromptLab pages — migrate to tokens when touching those files.
- `DirectorModal.tsx` and other lab components use raw radius numbers (6/8/10/12/14) — map to tokens on next substantive edit.
- The studio skin keeps its own background palette (`#f3f3f5` warm gray vs dashboard white). Intentional for now; revisit if surfaces ever merge.
