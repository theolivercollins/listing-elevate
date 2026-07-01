# Listing Elevate design system — how to build with it

Listing Elevate is a real-estate listing-video product. This library covers three surfaces: the **marketing homepage**, the **owner/operator back end**, and the **agent back end**. Every component is the real shipped code, imported from `window.LE.<Name>` (bundle: `_ds_bundle.js`). Compose these parts; don't reinvent them.

## Setup & wrapping
- All styling ships in `styles.css` (which `@import`s `_ds_bundle.css`). Load it once — it defines every token and class below. Fonts: **Inter only** (both `font-sans` and `font-mono` resolve to Inter — this product has NO monospace UI text; never introduce a monospace face).
- Theme is driven by CSS custom properties on `:root` (light by default; a dark theme swaps the same variables). Components read these variables — style your own layout glue with them, don't hardcode hex.
- Chrome that reads app context — `TopNav`, `SiteNav`, `DashboardSidebar`, `ThemeToggle`, `LoginDialog` — expects a Router + theme + auth provider above it in a real app. Leaf components (KpiCard, Button, Card, StatusChip, etc.) need no wrapper.

## The styling idiom — two token subsystems + a class family
This DS styles via **CSS-variable tokens + a `le-*` class family** (plus Tailwind utilities for one-off layout). Use tokens/classes over ad-hoc CSS.

**Back-end / dashboard tokens** (owner + agent surfaces): `var(--ink)` (primary text), `var(--muted)` (secondary), `var(--accent)`, `var(--surface)` (card bg), `var(--border)`, and status colors `var(--good)` / `var(--warn)` / `var(--bad)`.

**Marketing / v2 tokens** (homepage): `var(--le-bg)`, `var(--le-bg-elev)`, `var(--le-bg-sunken)`, `var(--le-text)`, `var(--le-text-muted)`, `var(--le-border)` / `var(--le-border-strong)`, `var(--le-accent)` / `var(--le-accent-soft)` / `var(--le-accent-fg)`, and `rgb(var(--le-brand-blue-rgb))` for the brand blue.

**Class family** (real shipped classes): surfaces `le-card` / `le-card-flat` / `le-card-lift` / `le-card-strong`; buttons `le-btn` / `le-btn-dark` / `le-btn-primary` / `le-btn-ghost` and marketing CTAs `le-cta-primary` / `le-cta-textlink`; `le-badge` (+`le-badge-dot`); dashboard shell `le-dash-shell` / `le-dash-sidebar` / `le-dash-main`; headings `le-page-heading` / `le-page-h1` / `le-page-eyebrow`; responsive grids `le-cols-2-sm` / `le-cols-2-lg` / `le-cols-3-lg`. For dashboard metrics prefer the components (`KpiCard`, `MiniStat`, `StatusChip`, `Sparkline`, `Bars`, `Ring`) over rebuilding them from classes.

## Which parts to reach for
- **Homepage:** `SiteNav`, `Hero`, `Section` (wrapper for your own content), `Pricing`, `Process`, `MarketComparison` (+ `MarketDomination`/`MarketGap`/`CostComparison`/`ConsumerDemand`/`TurnaroundSpeed`), `SelectedWork`, `FounderOffer`, `FAQ`, `FinalCTA`, `Footer`; accents `LEButton`/`LEButtonLink`, `LEIcon`, `LELogoMark`, `SampleBadge`, `AccentDot`, `LECyclingWord`, `Reveal` (scroll-in), `Ambient` (bg aura).
- **Back ends:** shell = `DashboardSidebar` + `TopNav`; `PageHeading`, `SectionTitle`, `Card`, `KpiCard`, `MiniStat`, `MoneyValue`, `StatusChip`, `Sparkline`, `Bars`, `Ring`, `PropertyThumb`, `ActivityItem`, `AIBanner`, `HealthCard`, `EmptyState`, `Skeleton`/`SkeletonRow`, `AccountSubNav`, `Icon` (name-based icon set), `AddressAutocomplete`; forms `Button`, `Input`, `Label`, `RadioGroup`, `Dialog`, `DropdownMenu`, `Tooltip`, `Toaster`.

Read each component's `.d.ts` (its prop contract) and `.prompt.md` (usage) before composing, and `styles.css` for the full token/class set.

## One idiomatic snippet — a back-end KPI row
```tsx
// window.LE.* are the real components; style your grid with the DS tokens.
<div className="le-cols-3-lg" style={{ display: "grid", gap: 16 }}>
  <KpiCard label="Delivered today" value="3" sub="3 videos today" delta={12.5} />
  <KpiCard label="Spend · 7d" value={<MoneyValue cents={128000} />} sub="all providers" delta={8.2} deltaPositiveIsGood={false} />
  <KpiCard label="QC pass rate" value="96%" sub="2 manual, rest auto" delta={3.1} />
</div>
```
