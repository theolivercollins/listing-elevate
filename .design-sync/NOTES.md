# design-sync notes — Listing Elevate (reelready)

Repo-specific gotchas for syncing this design system to claude.ai/design. Read before every re-sync.

## Shape & scope
- **This is a Vite *app*, not a published component library.** No lib `dist/` entry exists, so we run the **package shape with a hand-authored barrel entry** at `.design-sync/entry.tsx` (pinned via `cfg.entry`). The barrel `export *`s the in-use components onto `window.LE`.
- **Scope = three product surfaces** (Oliver's directive, 2026-07-01, refined): **homepage + owner/operator back end + agent back end**. NOT the full site, and NOT admin/studio/development/blog/email tooling. We sync from **`origin/main`** (= listingelevate.com), NOT feature branches.
- **Role model gotcha:** there is no separate "owner" vs "agent" role in code — `profile.role` is `admin | user` only (`src/lib/auth.tsx`). `DashboardIndex` routes `admin → Overview` (the operator / "owner" back end) and `user → AgentHome` (agent back end). Both dashboards import the SAME files (`src/components/dashboard/primitives.tsx` + `icons.tsx`); no role-unique component files exist.
- **60 component cards** = homepage (v2 landing + market + primitives + SiteNav + LoginDialog) + 10 in-scope shadcn/ui primitives (button, dialog, dropdown-menu, input, label, radio-group, tooltip, toast, toaster, sonner) + the back-end design system (`dashboard/primitives.tsx`: PageHeading, KpiCard, Sparkline, Bars, Ring, PropertyThumb, AIBanner, MiniStat, ActivityItem, HealthCard, Card, SectionTitle, StatusChip, EmptyState, Skeleton, SkeletonRow, MoneyValue; plus Icon, AccountSubNav, TopNav, DashboardSidebar, AddressAutocomplete, ThemeToggle).
- **Dropped vs the earlier full-site trace:** AlertDialog, Checkbox, Textarea, Popover (admin/studio only), PricingCalculator (commented out on the live homepage). The back ends do NOT use card/table/badge/tabs/select — the dashboards roll their own primitives.
- `LoginDialogContext` is a provider, not a card. AnimatedIcons.tsx exports 4 icons but only AnimatedCircleCheck/AnimatedCircleX are used on the homepage → only those two are carded.

## Build inputs (the non-obvious bits)
- **CSS = compiled Tailwind, not source.** Components style via Tailwind utility classes generated at build time. `cfg.cssEntry` points at `.design-sync/.cache/compiled.css`, which is a copy of `dist/assets/index-*.css` (the only compiled CSS carrying `--le-` tokens; the `arco-*`/`email-editor-*` CSS are admin-studio only, not needed). The hash changes per build, so `cfg.buildCmd` runs `vite build` then copies it to the stable path.
- `cfg.tsconfig = tsconfig.app.json` (root tsconfig.json is a no-op per repo convention; the app config carries the `@/* → ./src/*` paths esbuild needs).
- **node_modules:** worktrees have none — symlink the main repo's: `ln -s /Users/oliverhelgemo/listing-elevate/node_modules node_modules`. Build with `--node-modules ./node_modules`.
- **Barrel collisions handled** (don't regress): `Toaster` is exported by both `ui/toaster.tsx` and `ui/sonner.tsx` → aliased (`Toaster` from toaster, `SonnerToaster` from sonner). The 6 `landing/market/*` files are **default-export-only** → barrel uses `export { default as <Name> }` (a bare `export *` silently drops defaults — would yield zero exports for those six).
- `AnimatedIcons.tsx` has no `AnimatedIcons` export; it exports `AnimatedCheck/X/CircleCheck/CircleX` — carded individually.

## Provider
- `cfg.provider = { component: "DSProvider" }` — DSProvider (in the barrel) chains `MemoryRouter` > `ThemeProvider` (`@/lib/theme`) > `AuthProvider` (`@/lib/auth`) > `LoginDialogProvider` (`@/v2/components/auth/LoginDialogContext`). The back-end chrome (TopNav, DashboardSidebar, ThemeToggle) needs theme + auth + router. Verified module-load-safe: `AuthProvider`'s `getSession()` runs in a useEffect (resolves to logged-out, doesn't throw); supabase client has hardcoded fallbacks. No QueryClient needed (DashboardSidebar's data effect is admin-gated and never fires in the logged-out preview state).
- `@/lib/supabase` self-initializes at module load but has hardcoded prod URL/anon-key fallbacks, so the IIFE doesn't throw. That anon key is already public in the shipped app bundle (RLS-protected) — no new exposure.
- **Route-sensitive chrome:** `TopNav` returns null on `/` and `/dashboard/*` (the default MemoryRouter route is `/`), so it shows a floor card unless its preview is route-tuned. `DashboardSidebar` renders fine at `/`. `SiteNav` (landing nav) also needs authoring to render in-card.

## Preview authoring — hard-won rules
- **Preview `.tsx` imports MUST use the package name `"reelready"`, NOT `@/...`.** The story-import rewrite (`exportedComponentFor`) only redirects an `@/` import to `window.LE` when the resolved FILENAME equals a PascalCase exported component name. Kebab/lowercase files (`button.tsx`→`Button`) and multi-component files (`dashboard/primitives.tsx`→`KpiCard`/`EmptyState`…) DON'T match, so `@/` imports bundle the component from SOURCE — pulling a DUPLICATE react-router whose context the auto `DSProvider` never fills → `useLocation/useNavigate/Link "must be used within a <Router>"` errors (hit TopNav, SiteNav, EmptyState). Importing from `"reelready"` routes through the reliable rule-1 shim to `window.LE`. If you add previews, import from `"reelready"`.
- **`toast.tsx` is in the barrel** (`export * from "@/components/ui/toast"`) so the Toast primitives (Toast/ToastProvider/ToastViewport/…) reach `window.LE`. A Radix Toast needs a `<ToastViewport/>` inside `<ToastProvider>` to render at all; the Toaster preview composes both (+ a surface bg so the render-check PNG clears the 5KB blank threshold).
- **Overlays/chrome use `cardMode`:** Dialog/DropdownMenu/Tooltip/LoginDialog/Toaster → `single` (portal covers the card); Bars/Icon/KpiCard/PageHeading/Sparkline/LEIcon → `column` (wide grids/charts); SiteNav/TopNav → `single` (fixed/sticky full-width).
- **Dark-context components** (SampleBadge — white-on-transparent) need a dark canvas (`background: var(--ink)`) in their preview or they're invisible.
- Provider route is pinned to `/account` (MemoryRouter initialEntries) so TopNav renders (it returns null on `/` and `/dashboard/*`).

## Known render warns (benign — don't re-chase)
- `[RENDER_THIN] Sparkline` — it's a line chart with no text nodes by design; the screenshot shows the trend line (Default/Flat/NoFillWithDots). Verified benign.

## Re-sync risks (watch-list)
- **LoginDialog** is auth/MFA-driven — likely a floor card or thin preview; don't expect a rich render.
- Landing sections (Hero, Pricing, FAQ, …) are full-page compositions with scroll/intersection animations (Reveal, framer-motion) — they render but may look odd in a small card; candidates for `cardMode: column`.
- The compiled-CSS copy is build-output (gitignored under `.cache/`); a re-sync MUST run `cfg.buildCmd` first or previews render unstyled.
- Fonts: Inter is loaded via a Google Fonts `@import` (remote) in the source CSS — `[FONT_REMOTE]` expected, no action.
