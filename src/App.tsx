import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { RequireAuth, RequireAdmin } from "@/components/ProtectedRoute";
import { TopNav } from "@/components/TopNav";
import Index from "./pages/Index";
import V2Landing from "./v2/pages/Landing";
import Upload from "./pages/Upload";
import Presets from "./pages/Presets";
import Status from "./pages/Status";
import AuthCallback from "./pages/AuthCallback";
import { LoginDialogProvider } from "@/v2/components/auth/LoginDialogContext";
import Account from "./pages/Account";
import AccountProperties from "./pages/account/Properties";
import AccountBilling from "./pages/account/Billing";
import AccountProfile from "./pages/account/Profile";
import Dashboard from "./pages/Dashboard";
import DashboardOverview from "./pages/dashboard/Overview";
import DashboardPipeline from "./pages/dashboard/Pipeline";
import DashboardListings from "./pages/dashboard/Listings";
import PropertyDetail from "./pages/dashboard/PropertyDetail";
import DashboardFinances from "./pages/dashboard/Finances";
import DashboardDevelopment from "./pages/dashboard/Development";
import DashboardPromptLab from "./pages/dashboard/PromptLab";
import DashboardPromptLabRecipes from "./pages/dashboard/PromptLabRecipes";
import DashboardKnowledgeMap from "./pages/dashboard/KnowledgeMap";
import DashboardKnowledgeMapCell from "./pages/dashboard/KnowledgeMapCell";
import DashboardSystemStatus from "./pages/dashboard/SystemStatus";
import DashboardUsers from "./pages/dashboard/Users";
import DashboardToolsBlog from "./pages/dashboard/ToolsBlog";
import BlogPostsList from "./pages/dashboard/BlogPostsList";
import BlogPostDetail from "./pages/dashboard/BlogPostDetail";
import BlogImageLibrary from "./pages/dashboard/BlogImageLibrary";
import BlogTemplates from "./pages/dashboard/BlogTemplates";
import BlogTemplateDetail from "./pages/dashboard/BlogTemplateDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// Redirect helper for parameterised routes
// ---------------------------------------------------------------------------
function RedirectWithParams({ to }: { to: (params: Record<string, string>) => string }) {
  const params = useParams();
  return <Navigate to={to(params as Record<string, string>)} replace />;
}

// ---------------------------------------------------------------------------
// Inline stub placeholders (replaced by real pages in later subagent dispatches)
// ---------------------------------------------------------------------------
function OrdersStubPlaceholder() {
  return (
    <div className="rounded-[14px] border p-12 text-center" style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)" }}>
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Coming soon</div>
      <h2 className="le-display mt-2 text-[24px]" style={{ color: "var(--le-text)" }}>Customer orders</h2>
      <p className="mt-4 text-sm" style={{ color: "var(--le-text-muted)" }}>
        Customer-grouped view of all property orders. Build coming in Stage 4 follow-up.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <LoginDialogProvider>
              <TopNav />
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<V2Landing />} />
                {/* Legacy preview routes — redirect to the new root */}
                <Route path="/v2" element={<Navigate to="/" replace />} />
                <Route path="/legacy" element={<Index />} />
                <Route path="/login" element={<Navigate to="/?login=1" replace />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/status/:id" element={<Status />} />

                {/* Authenticated user routes */}
                <Route element={<RequireAuth />}>
                  <Route path="/upload" element={<Upload />} />
                  <Route path="/presets" element={<Presets />} />
                  <Route path="/account" element={<Account />}>
                    <Route index element={<Navigate to="properties" replace />} />
                    <Route path="properties" element={<AccountProperties />} />
                    <Route path="billing" element={<AccountBilling />} />
                    <Route path="profile" element={<AccountProfile />} />
                  </Route>
                </Route>

                {/* Admin routes */}
                <Route element={<RequireAdmin />}>
                  <Route path="/dashboard" element={<Dashboard />}>
                    {/* ── Overview ──────────────────────────────────────── */}
                    <Route index element={<DashboardOverview />} />

                    {/* ── Orders ────────────────────────────────────────── */}
                    <Route path="orders" element={<OrdersStubPlaceholder />} />
                    <Route path="orders/pipeline" element={<DashboardPipeline />} />

                    {/* ── Users ─────────────────────────────────────────── */}
                    <Route path="users" element={<DashboardUsers />} />

                    {/* ── Listings ──────────────────────────────────────── */}
                    <Route path="listings" element={<DashboardListings />} />
                    <Route path="listings/:id" element={<PropertyDetail />} />

                    {/* ── Finances ──────────────────────────────────────── */}
                    <Route path="finances" element={<DashboardFinances />} />

                    {/* ── Tools / Blog hub ──────────────────────────────── */}
                    <Route path="tools/blog" element={<DashboardToolsBlog />} />

                    {/* ── Dev ───────────────────────────────────────────── */}
                    <Route path="dev" element={<DashboardDevelopment />} />
                    <Route path="dev/prompt-lab" element={<DashboardPromptLab />} />
                    <Route path="dev/prompt-lab/:sessionId" element={<DashboardPromptLab />} />
                    <Route path="dev/recipes" element={<DashboardPromptLabRecipes />} />
                    <Route path="dev/knowledge-map" element={<DashboardKnowledgeMap />} />
                    <Route path="dev/knowledge-map/:cellKey" element={<DashboardKnowledgeMapCell />} />
                    <Route path="dev/system-status" element={<DashboardSystemStatus />} />

                    {/* ── Blog detail pages (kept as-is; hub uses tab params) */}
                    <Route path="blog/posts/new" element={<BlogPostDetail />} />
                    <Route path="blog/posts/:id" element={<BlogPostDetail />} />
                    <Route path="blog/templates/new" element={<BlogTemplateDetail />} />
                    <Route path="blog/templates/:id" element={<BlogTemplateDetail />} />

                    {/* ── Redirects from legacy paths ───────────────────── */}

                    {/* pipeline → orders/pipeline */}
                    <Route path="pipeline" element={<Navigate to="/dashboard/orders/pipeline" replace />} />

                    {/* properties → listings */}
                    <Route path="properties" element={<Navigate to="/dashboard/listings" replace />} />
                    <Route
                      path="properties/:id"
                      element={<RedirectWithParams to={(p) => `/dashboard/listings/${p.id}`} />}
                    />

                    {/* development → dev */}
                    <Route path="development" element={<Navigate to="/dashboard/dev" replace />} />
                    <Route path="development/prompt-lab" element={<Navigate to="/dashboard/dev/prompt-lab" replace />} />
                    <Route path="development/prompt-lab/recipes" element={<Navigate to="/dashboard/dev/recipes" replace />} />
                    <Route path="development/knowledge-map" element={<Navigate to="/dashboard/dev/knowledge-map" replace />} />
                    <Route path="development/system-status" element={<Navigate to="/dashboard/dev/system-status" replace />} />
                    <Route path="development/proposals" element={<Navigate to="/dashboard/dev" replace />} />
                    <Route path="development/lab" element={<Navigate to="/dashboard/dev/prompt-lab" replace />} />
                    <Route path="development/lab/new" element={<Navigate to="/dashboard/dev/prompt-lab" replace />} />
                    <Route
                      path="development/lab/:id"
                      element={<Navigate to="/dashboard/dev/prompt-lab" replace />}
                    />

                    {/* logs → dev/system-status */}
                    <Route path="logs" element={<Navigate to="/dashboard/dev/system-status" replace />} />

                    {/* settings → overview */}
                    <Route path="settings" element={<Navigate to="/dashboard" replace />} />

                    {/* rating-ledger → dev/system-status */}
                    <Route path="rating-ledger" element={<Navigate to="/dashboard/dev/system-status" replace />} />

                    {/* blog list pages → tools/blog with tab param */}
                    <Route path="blog/posts" element={<Navigate to="/dashboard/tools/blog?tab=posts" replace />} />
                    <Route path="blog/images" element={<Navigate to="/dashboard/tools/blog?tab=images" replace />} />
                    <Route path="blog/templates" element={<Navigate to="/dashboard/tools/blog?tab=templates" replace />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </LoginDialogProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
