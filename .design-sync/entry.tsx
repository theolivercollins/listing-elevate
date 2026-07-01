// design-sync barrel entry — re-exports the site's in-use components for the claude.ai/design bundle. Generated input, not app code.

// ── shadcn/ui primitives (src/components/ui/) ──────────────────────────────
export * from "@/components/ui/button";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/input";
export * from "@/components/ui/label";
export * from "@/components/ui/radio-group";
export * from "@/components/ui/tooltip";

// toaster.tsx and sonner.tsx both export a component named `Toaster`.
// `export *` silently drops whichever loses the collision, so both are
// re-exported explicitly with disambiguating names instead of `export *`.
export { Toaster } from "@/components/ui/toaster";
export { Toaster as SonnerToaster, toast } from "@/components/ui/sonner";
// Toast primitives (ToastProvider/Toast/ToastTitle/…) so previews + the design agent can compose toasts.
export * from "@/components/ui/toast";

// ── v2 — nav / auth ──────────────────────────────────────────────────────
export * from "@/v2/components/SiteNav";
export * from "@/v2/components/auth/LoginDialog";

// ── v2 — landing sections ───────────────────────────────────────────────
export * from "@/v2/components/landing/Hero";
export * from "@/v2/components/landing/Section";
export * from "@/v2/components/landing/FounderOffer";
export * from "@/v2/components/landing/Pricing";
export * from "@/v2/components/landing/SelectedWork";
export * from "@/v2/components/landing/FinalCTA";
export * from "@/v2/components/landing/Footer";
export * from "@/v2/components/landing/MarketComparison";
export * from "@/v2/components/landing/Process";
export * from "@/v2/components/landing/FAQ";
// FAQ is all-caps → the converter's isComponentName heuristic treats it as a constant; alias to PascalCase so it cards.
export { FAQ as Faq } from "@/v2/components/landing/FAQ";

// ── v2 — landing/market — these five files only `export default`, which
// `export *` does NOT re-export (ES module spec: `export *` forwards named
// exports only, never the default binding). Re-exported explicitly under
// the filename-matching name so each survives as a named export.
// NOTE: PricingCalculator is intentionally out of scope for this bundle.
export { default as MarketDomination } from "@/v2/components/landing/market/MarketDomination";
export { default as ConsumerDemand } from "@/v2/components/landing/market/ConsumerDemand";
export { default as MarketGap } from "@/v2/components/landing/market/MarketGap";
export { default as CostComparison } from "@/v2/components/landing/market/CostComparison";
export { default as TurnaroundSpeed } from "@/v2/components/landing/market/TurnaroundSpeed";

// ── v2 — primitives ──────────────────────────────────────────────────────
export * from "@/v2/components/primitives/AccentDot";
export * from "@/v2/components/primitives/Ambient";
export * from "@/v2/components/primitives/AnimatedIcons";
export * from "@/v2/components/primitives/LEButton";
export * from "@/v2/components/primitives/LECyclingWord";
export * from "@/v2/components/primitives/LEIcon";
export * from "@/v2/components/primitives/LELogoMark";
export * from "@/v2/components/primitives/Reveal";
export * from "@/v2/components/primitives/SampleBadge";

// ── dashboard — back-end design system (owner/operator + agent) ─────────
// primitives.tsx is a multi-export module: PageHeading, KpiCard, Sparkline,
// Bars, Ring, PropertyThumb, AIBanner, MiniStat, ActivityItem, HealthCard,
// Card, SectionTitle, StatusChip, EmptyState, Skeleton, SkeletonRow,
// MoneyValue all card individually; fmtCents/fmtMoney/fmtCentsK/fmtDuration/
// fmtRel are plain helpers that ride along on `export *` but are not cards.
export * from "@/components/dashboard/primitives";
export * from "@/components/dashboard/icons";
export * from "@/components/dashboard/AccountSubNav";

// ── chrome — app shell ───────────────────────────────────────────────────
export * from "@/components/TopNav";
export * from "@/components/DashboardSidebar";
export * from "@/components/AddressAutocomplete";
export * from "@/components/brand/ThemeToggle";

// ── design-bundle preview provider ──────────────────────────────────────
// Chain required by the chrome components above:
//   MemoryRouter    — TopNav / DashboardSidebar / AccountSubNav / LoginDialogProvider
//                      all call react-router-dom hooks (useLocation/useNavigate/Link).
//   ThemeProvider    — TopNav / DashboardSidebar / ThemeToggle call useTheme().
//   AuthProvider     — TopNav / DashboardSidebar call useAuth(). Module-load-safe:
//                      the Supabase client (src/lib/supabase.ts) has hardcoded
//                      fallback URL/anon-key constants, so import never throws even
//                      without env vars, and AuthProvider's supabase.auth.getSession()
//                      call happens inside a useEffect (not at module scope) — it
//                      resolves to a logged-out state rather than hanging or throwing.
//   LoginDialogProvider — pre-existing in the barrel; needed by LoginDialog/SiteNav.
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { LoginDialogProvider } from "@/v2/components/auth/LoginDialogContext";
import type { ReactNode } from "react";
export function DSProvider({ children }: { children: ReactNode }) {
  return (
    // initialEntries="/account": a generic authed route where TopNav renders
    // (it returns null on "/" and "/dashboard/*"); DashboardSidebar/landing are route-agnostic.
    <MemoryRouter initialEntries={["/account"]}>
      <ThemeProvider>
        <AuthProvider>
          <LoginDialogProvider>{children}</LoginDialogProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
