# UI Consistency Pass — plan

Date: 2026-06-09 · Branch: `feat/ui-consistency-pass` (off `main` 7ec5c4a)
Goal: buttons, spacing, nav, typography cohesive — everything conforms to the existing design system. **No re-theming.**

## Canon (two intentional design languages — do NOT merge them)

| | L1 — Editorial dark | L2 — Soft app shell |
|---|---|---|
| Surfaces | marketing v2, auth (Login/LoginDialog), share-public, Upload success/cancelled, NotFound, Status, Presets | dashboard shell + all `/dashboard/*` pages, `.studio-scope`, Upload `glass.css` |
| Tokens | root `--le-*` (tokens.css 1–230) | scoped `--bg/--surface/--ink/--muted/--line/--accent #2a6fdb/--radius 18/--radius-sm 12/--radius-pill 999/--shadow-*` (`.le-dash-shell`, `.studio-scope`, glass.css) |
| Buttons | `LEButton`/`LEButtonLink`/`leButtonStyle` (4px radius — canonical, keep) | `.le-btn-dark` / `.le-btn-ghost` (dash), `.studio-btn-*`/`.studio-cta-primary` (studio), `.g-cta-primary`/`.g-btn-ghost` (upload) |
| Eyebrow | `.le-eyebrow` | `.le-page-eyebrow` / `.studio-page-eyebrow` / `.studio-section-eyebrow` |

Non-findings (audit noise, rejected): marketing 4px button radius (LEButton canon); Tailwind `font-mono` + `--le-font-mono` (both alias Inter); studio blue accent vs ink accent (L2 vs L1 is deliberate); `.le-mono` class name (renders Inter).

## Workstreams

### WS1 — Hard-rule + accessibility (P0)
1. `Settings.tsx:106,246,373` — real monospace (`ui-monospace, SF Mono, Menlo`) → Inter + `tabular-nums`. Only true mono violations in repo.
2. Focus-visible rings missing: add canonical `:focus-visible { outline: 2px solid <scope accent>; outline-offset: 2px; }` coverage for `.studio-scope` inputs/buttons (currently box-shadow only), `glass.css` interactive elements, `share-public.css` inputs/buttons.
3. Danger color drift: `share-public.css:204` `#ff8a8a`, `share-studio.css:366–368` `#b02a2a` → `--le-danger` / scoped `--bad`.
4. Marketing hover states: nav links, Hero/FinalCTA/Pricing/FounderOffer CTAs, FAQ toggle — none have hover feedback. Add consistent pattern (opacity/brightness + 150–200ms transition), matching `.le-btn-primary:hover` precedent.

### WS2 — Button cohesion (P0)
5. Marketing CTAs (Hero ×2, FinalCTA ×2, Pricing ×2, FounderOffer, SiteNav) — hand-rolled copies → `LEButtonLink`/`leButtonStyle`. Visual parity (white-on-dark Hero/FinalCTA = primary on dark theme; padding maps to sm/md/lg sizes).
6. Blog/Email parity: `EmailDetail` + `EmailChatCompose` use shadcn Button while `BlogPostDetail`/lists/`BlogPostChatCompose` use `.le-btn-*` → unify on `.le-btn-dark`/`.le-btn-ghost` (the dominant dashboard pattern). Dedupe the byte-identical `tabBtnBase` + StatePill logic in `BlogPostsList`/`EmailsList` into shared dashboard components.
7. Studio: kill inline overrides on `.studio-btn-ghost` (fontSize/padding) — add a `.studio-btn-sm` modifier in studio-design.css instead. `ClientPicker` `<select>` inline styles → `.studio-input`.

### WS3 — Token hygiene, zero visual change (P1)
8. Hardcoded values that exactly equal a token → token reference: `#fff`→`var(--surface)`, `rgba(11,11,16,0.07)`→`var(--line)`, dropdown shadows→`var(--shadow-lg)`, account/billing table header `rgba(11,11,16,0.02)`→`var(--line-2)`-family, auth page `#050710/#0b0f1c/rgba(220,230,255,…)`→ dark `--le-bg/--le-bg-elev/--le-border`, `#07080c`→`var(--le-accent-fg)`/`var(--le-accent)`.
9. Radii: `borderRadius: 99` → `999`/`var(--radius-pill)` everywhere. Sibling-page micro-radii made consistent (compose pages match each other).
10. Eyebrow dedup: LoginDialog/Login inline eyebrow objects → `.le-eyebrow`; studio SectionCard/ClientEdit inline eyebrows → `.studio-section-eyebrow`/`.studio-section-h3`; MarketComparison custom eyebrow → `.le-eyebrow`.
11. `ClientEdit.tsx:271` h1 40px override → `.studio-page-h1` default (56px) like every other studio page.

### WS4 — Dark mode completion (P1)
12. Add `.dark .studio-scope { … }` block mirroring `.dark .le-dash-shell` values (same design language, same dark palette).
13. Dark-breaking hardcodes: `EmailDetail.tsx:562` `#fff` sidebar, compose preview *chrome* → tokens. Rendered-HTML preview panes stay white (content is white by nature); media player `#000` surrounds stay.

### WS5 — Spacing / nav cohesion (P2)
14. Marketing section rhythm: FounderOffer fixed 24px (verify in context — if a full section, align to `clamp(56px,12vw,140px)`); Process asymmetric clamp 112/120 → 140 max like siblings; MarketComparison mixed Tailwind/inline rhythm → align.
15. Lab: PromptLab Tailwind grid/spacing classes → match sibling token-style grids (same computed values).
16. `AccountSubNav` hardcoded rgba → scoped token.

## Execution
Subagent per workstream-surface, worktree `.claude/worktrees/ui-consistency`, small commits per workstream. Verify: `pnpm build` + test suite + spot visual re-audit. No push (Oliver gates pushes/PRs).
