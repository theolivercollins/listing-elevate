/**
 * AppRoutes — the application route tree, extracted from App.tsx so it can be
 * mounted under either BrowserRouter (production) or MemoryRouter (tests).
 *
 * Role split (feat/authed-app-role-split):
 *
 *   /dashboard (RequireAuth wrapper):
 *     index  → admin: Overview  |  non-admin: AgentHome
 *     account/* → all authed users
 *
 *   /dashboard/** (nested RequireAdmin):
 *     pipeline, properties, users, logs, development/*, rating-ledger,
 *     finances, settings, studio/* → admin only; non-admins redirect to
 *     /dashboard (previously /account, which caused an infinite redirect loop).
 *
 * Code splitting (feat/studio-perf):
 *
 *   Every routed PAGE component below is loaded via React.lazy so only the
 *   route the operator actually opens ships its JS — previously all 50+
 *   dashboard/studio/blog/email pages were statically imported here and
 *   shipped in a single main bundle regardless of route. Each lazy route's
 *   `element` is wrapped with `withSuspense()`, which gives it its own local
 *   Suspense boundary — a route change swaps just that leaf for the
 *   `RouteLoader` fallback rather than unmounting the whole matched tree
 *   (so the /dashboard shell + sidebar stay put while nested content loads).
 *   The outer <Suspense> around <Routes> is a backstop, not the primary
 *   mechanism.
 *
 *   Kept eager (not lazy):
 *     - V2Landing (`/`)      — the public marketing entry point; first paint
 *                              for anonymous visitors shouldn't wait on a
 *                              lazy chunk + Suspense flash.
 *     - Dashboard (shell)    — layout shell for the whole /dashboard subtree
 *                              (sidebar, topbar, <Outlet/>); lazifying it
 *                              would flash away the shell itself on every
 *                              nested route's first load.
 *     - NotFound (`*`)       — tiny catch-all; instant render is better UX
 *                              than a spinner-then-404.
 *     - RequireAuth/RequireAdmin/TopNav/LoginDialogProvider/ScrollToTop
 *                            — chrome and route guards, not routed pages.
 */

import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireAuth, RequireAdmin } from "@/components/ProtectedRoute";
import { TopNav } from "@/components/TopNav";
import { LoginDialogProvider } from "@/v2/components/auth/LoginDialogContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { RouteLoader } from "@/components/RouteLoader";
import { useAuth } from "@/lib/auth";

// ─── Eager — shell, guards' targets, first-paint-critical ──────────────────
import V2Landing from "./v2/pages/Landing";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

// ─── Lazy — top-level / auth-flow pages ─────────────────────────────────────
const Index = lazy(() => import("./pages/Index"));
const Upload = lazy(() => import("./pages/Upload"));
const UploadSuccess = lazy(() => import("./pages/UploadSuccess"));
const UploadCancelled = lazy(() => import("./pages/UploadCancelled"));
const Presets = lazy(() => import("./pages/Presets"));
const Status = lazy(() => import("./pages/Status"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));

// ─── Lazy — dashboard account pages ─────────────────────────────────────────
const DashboardAccountProfile = lazy(() => import("./pages/dashboard/account/Profile"));
const DashboardAccountBilling = lazy(() => import("./pages/dashboard/account/Billing"));
const DashboardAccountListings = lazy(() => import("./pages/dashboard/account/Listings"));

// ─── Lazy — dashboard operator pages ────────────────────────────────────────
const DashboardOverview = lazy(() => import("./pages/dashboard/Overview"));
const AgentHome = lazy(() => import("./pages/dashboard/AgentHome"));
const DashboardPipeline = lazy(() => import("./pages/dashboard/Pipeline"));
const DashboardProperties = lazy(() => import("./pages/dashboard/Properties"));
const PropertyDetail = lazy(() => import("./pages/dashboard/PropertyDetail"));
const DashboardLogs = lazy(() => import("./pages/dashboard/Logs"));
const DashboardFinances = lazy(() => import("./pages/dashboard/Finances"));
const DashboardSettings = lazy(() => import("./pages/dashboard/Settings"));
const DashboardUsers = lazy(() => import("./pages/dashboard/Users"));
const DashboardDevelopment = lazy(() => import("./pages/dashboard/Development"));
const DashboardLearning = lazy(() => import("./pages/dashboard/Learning"));
const DashboardPromptLab = lazy(() => import("./pages/dashboard/PromptLab"));
const DashboardPromptLabRecipes = lazy(() => import("./pages/dashboard/PromptLabRecipes"));
const DashboardPromptProposals = lazy(() => import("./pages/dashboard/PromptProposals"));
const DashboardKnowledgeMap = lazy(() => import("./pages/dashboard/KnowledgeMap"));
const DashboardKnowledgeMapCell = lazy(() => import("./pages/dashboard/KnowledgeMapCell"));
const DashboardSystemStatus = lazy(() => import("./pages/dashboard/SystemStatus"));
const DashboardLabListings = lazy(() => import("./pages/dashboard/LabListings"));
const DashboardLabListingNew = lazy(() => import("./pages/dashboard/LabListingNew"));
const DashboardLabListingDetail = lazy(() => import("./pages/dashboard/LabListingDetail"));
const DashboardRatingLedger = lazy(() => import("./pages/dashboard/RatingLedger"));

// ─── Lazy — blog pages ───────────────────────────────────────────────────────
const BlogPostsList = lazy(() => import("./pages/dashboard/BlogPostsList"));
const BlogPostDetail = lazy(() => import("./pages/dashboard/BlogPostDetail"));
const BlogAllyHistory = lazy(() => import("./pages/dashboard/BlogAllyHistory"));
const BlogImageLibrary = lazy(() => import("./pages/dashboard/BlogImageLibrary"));
const BlogTemplates = lazy(() => import("./pages/dashboard/BlogTemplates"));
const MarketUpdate = lazy(() => import("./pages/dashboard/MarketUpdate"));
const BlogTemplateDetail = lazy(() => import("./pages/dashboard/BlogTemplateDetail"));

// ─── Lazy — email pages ──────────────────────────────────────────────────────
const EmailsList = lazy(() => import("./pages/dashboard/EmailsList"));
const EmailDetail = lazy(() => import("./pages/dashboard/EmailDetail"));
const EmailTemplates = lazy(() => import("./pages/dashboard/EmailTemplates"));
const EmailTemplateDetail = lazy(() => import("./pages/dashboard/EmailTemplateDetail"));

// ─── Lazy — studio (video) pages ─────────────────────────────────────────────
const StudioHome = lazy(() => import("./pages/dashboard/studio/StudioHome"));
const StudioNew = lazy(() => import("./pages/dashboard/studio/StudioNew"));
const StudioClients = lazy(() => import("./pages/dashboard/studio/Clients"));
const StudioClientEdit = lazy(() => import("./pages/dashboard/studio/ClientEdit"));
const StudioPropertyCommandCenter = lazy(() => import("./pages/dashboard/studio/PropertyCommandCenter"));
const StudioShare = lazy(() => import("./pages/dashboard/studio/Share"));
const StudioVideos = lazy(() => import("./pages/dashboard/studio/Videos"));
const StudioVideoHub = lazy(() => import("./pages/dashboard/studio/VideoHub"));

// ─── Lazy — public share / preview pages ────────────────────────────────────
const SharePresentation = lazy(() => import("./pages/share/Presentation"));
const ShareEmbed = lazy(() => import("./pages/share/Embed"));
const PreviewPage = lazy(() => import("./pages/preview/PreviewPage"));
const EmbedPage = lazy(() => import("./pages/preview/EmbedPage"));

/** Gives a single lazy route element its own local Suspense boundary. */
function withSuspense(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
}

function StudioRedirect({ to }: { to: string }) {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/dashboard/studio/${to}/${id ?? ""}`} replace />;
}

/**
 * DashboardIndex — role-aware index for /dashboard.
 * Admin → Overview (operator landing).
 * Non-admin (agent) → AgentHome placeholder (real one ships in task 4).
 */
function DashboardIndex() {
  const { profile } = useAuth();
  if (profile?.role === "admin") {
    return <DashboardOverview />;
  }
  return <AgentHome />;
}

export default function AppRoutes() {
  return (
    <LoginDialogProvider>
      <ScrollToTop />
      <TopNav />
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<V2Landing />} />
          {/* Legacy preview routes — redirect to the new root */}
          <Route path="/v2" element={<Navigate to="/" replace />} />
          <Route path="/legacy" element={withSuspense(<Index />)} />
          <Route path="/login" element={<Navigate to="/?login=1" replace />} />
          <Route path="/auth/callback" element={withSuspense(<AuthCallback />)} />
          <Route path="/status/:id" element={withSuspense(<Status />)} />
          {/* LE Video embed — more-specific path MUST be above the bare token route */}
          <Route path="/preview/:token/embed" element={withSuspense(<EmbedPage />)} />
          <Route path="/preview/:token" element={withSuspense(<PreviewPage />)} />
          {/* Public Vimeo-style share viewer (presentation + embed) */}
          <Route path="/v/:token" element={withSuspense(<SharePresentation />)} />
          <Route path="/embed/:token" element={withSuspense(<ShareEmbed />)} />

          {/* Backwards-compat redirects for old /account/* bookmarks */}
          <Route path="/account" element={<Navigate to="/dashboard/account/profile" replace />} />
          <Route path="/account/profile" element={<Navigate to="/dashboard/account/profile" replace />} />
          <Route path="/account/billing" element={<Navigate to="/dashboard/account/billing" replace />} />
          <Route path="/account/properties" element={<Navigate to="/dashboard/account/listings" replace />} />

          {/* Stripe Checkout redirect targets — public so Stripe can land here */}
          <Route path="/upload/success" element={withSuspense(<UploadSuccess />)} />
          <Route path="/upload/cancelled" element={withSuspense(<UploadCancelled />)} />

          {/* Authenticated user routes — all authed users, including agents */}
          <Route element={<RequireAuth />}>
            <Route path="/upload" element={withSuspense(<Upload />)} />
            <Route path="/presets" element={withSuspense(<Presets />)} />

            {/* /dashboard — open to all authed users; role determines the index */}
            <Route path="/dashboard" element={<Dashboard />}>
              {/* Role-aware index: admin → Overview, agent → AgentHome */}
              <Route index element={withSuspense(<DashboardIndex />)} />

              {/* Account pages — available to all authed users */}
              <Route path="account">
                <Route index element={<Navigate to="profile" replace />} />
                <Route path="profile" element={withSuspense(<DashboardAccountProfile />)} />
                <Route path="billing" element={withSuspense(<DashboardAccountBilling />)} />
                <Route path="listings" element={withSuspense(<DashboardAccountListings />)} />
              </Route>

              {/* Operator-only sub-routes — non-admins are redirected to /dashboard */}
              <Route element={<RequireAdmin />}>
                <Route path="pipeline" element={withSuspense(<DashboardPipeline />)} />
                <Route path="properties" element={withSuspense(<DashboardProperties />)} />
                <Route path="properties/:id" element={withSuspense(<PropertyDetail />)} />
                <Route path="logs" element={withSuspense(<DashboardLogs />)} />
                <Route path="development" element={withSuspense(<DashboardDevelopment />)} />
                <Route path="development/learning" element={withSuspense(<DashboardLearning />)} />
                <Route path="development/prompt-lab" element={withSuspense(<DashboardPromptLab />)} />
                <Route path="development/prompt-lab/recipes" element={withSuspense(<DashboardPromptLabRecipes />)} />
                <Route path="development/prompt-lab/:sessionId" element={withSuspense(<DashboardPromptLab />)} />
                <Route path="development/proposals" element={withSuspense(<DashboardPromptProposals />)} />
                <Route path="development/knowledge-map" element={withSuspense(<DashboardKnowledgeMap />)} />
                <Route path="development/knowledge-map/:cellKey" element={withSuspense(<DashboardKnowledgeMapCell />)} />
                <Route path="development/system-status" element={withSuspense(<DashboardSystemStatus />)} />
                <Route path="development/lab" element={withSuspense(<DashboardLabListings />)} />
                <Route path="development/lab/new" element={withSuspense(<DashboardLabListingNew />)} />
                <Route path="development/lab/:id" element={withSuspense(<DashboardLabListingDetail />)} />
                <Route path="rating-ledger" element={withSuspense(<DashboardRatingLedger />)} />
                <Route path="finances" element={withSuspense(<DashboardFinances />)} />
                <Route path="users" element={withSuspense(<DashboardUsers />)} />
                <Route path="settings" element={withSuspense(<DashboardSettings />)} />

                {/* Video / Blog / Email — three separate sidebar tabs, URLs preserved */}
                <Route path="studio">
                  <Route index element={<Navigate to="video" replace />} />

                  {/* Video */}
                  <Route path="video" element={withSuspense(<StudioHome />)} />
                  <Route path="video/new" element={withSuspense(<StudioNew />)} />
                  <Route path="video/clients" element={withSuspense(<StudioClients />)} />
                  <Route path="video/share" element={withSuspense(<StudioShare />)} />
                  <Route path="video/clients/:id" element={withSuspense(<StudioClientEdit />)} />
                  <Route path="video/properties/:id" element={withSuspense(<StudioPropertyCommandCenter />)} />

                  {/* LE Video library + hub (spec §1/§2) */}
                  <Route path="videos" element={withSuspense(<StudioVideos />)} />
                  <Route path="videos/:propertyId" element={withSuspense(<StudioVideoHub />)} />

                  {/* Blog */}
                  <Route path="blog" element={<Navigate to="posts" replace />} />
                  <Route path="blog/posts" element={withSuspense(<BlogPostsList />)} />
                  <Route path="blog/market-update" element={withSuspense(<MarketUpdate />)} />
                  <Route path="blog/market-update/:id" element={withSuspense(<MarketUpdate />)} />
                  <Route path="blog/posts/new" element={withSuspense(<BlogPostDetail />)} />
                  <Route path="blog/posts/:id" element={withSuspense(<BlogPostDetail />)} />
                  <Route path="blog/ally-history" element={withSuspense(<BlogAllyHistory />)} />
                  <Route path="blog/images" element={withSuspense(<BlogImageLibrary />)} />
                  <Route path="blog/templates" element={withSuspense(<BlogTemplates />)} />
                  <Route path="blog/templates/new" element={withSuspense(<BlogTemplateDetail />)} />
                  <Route path="blog/templates/:id" element={withSuspense(<BlogTemplateDetail />)} />

                  {/* Email */}
                  <Route path="email" element={<Navigate to="messages" replace />} />
                  <Route path="email/messages" element={withSuspense(<EmailsList />)} />
                  <Route path="email/messages/new" element={withSuspense(<EmailDetail />)} />
                  <Route path="email/messages/:id" element={withSuspense(<EmailDetail />)} />
                  <Route path="email/templates" element={withSuspense(<EmailTemplates />)} />
                  <Route path="email/templates/new" element={withSuspense(<EmailTemplateDetail />)} />
                  <Route path="email/templates/:id" element={withSuspense(<EmailTemplateDetail />)} />
                </Route>

                {/* Redirects from pre-consolidation URLs */}
                <Route path="studio/new" element={<Navigate to="/dashboard/studio/video/new" replace />} />
                <Route path="studio/clients" element={<Navigate to="/dashboard/studio/video/clients" replace />} />
                <Route path="studio/clients/:id" element={<StudioRedirect to="video/clients" />} />
                <Route path="studio/properties/:id" element={<StudioRedirect to="video/properties" />} />
                <Route path="blog" element={<Navigate to="/dashboard/studio/blog/posts" replace />} />
                <Route path="blog/posts" element={<Navigate to="/dashboard/studio/blog/posts" replace />} />
                <Route path="blog/posts/new" element={<Navigate to="/dashboard/studio/blog/posts/new" replace />} />
                <Route path="blog/posts/:id" element={<StudioRedirect to="blog/posts" />} />
                <Route path="blog/ally-history" element={<Navigate to="/dashboard/studio/blog/ally-history" replace />} />
                <Route path="blog/images" element={<Navigate to="/dashboard/studio/blog/images" replace />} />
                <Route path="blog/templates" element={<Navigate to="/dashboard/studio/blog/templates" replace />} />
                <Route path="blog/templates/new" element={<Navigate to="/dashboard/studio/blog/templates/new" replace />} />
                <Route path="blog/templates/:id" element={<StudioRedirect to="blog/templates" />} />
                <Route path="blog/emails" element={<Navigate to="/dashboard/studio/email/messages" replace />} />
                <Route path="blog/emails/new" element={<Navigate to="/dashboard/studio/email/messages/new" replace />} />
                <Route path="blog/emails/:id" element={<StudioRedirect to="email/messages" />} />
                <Route path="blog/email-templates" element={<Navigate to="/dashboard/studio/email/templates" replace />} />
                <Route path="blog/email-templates/new" element={<Navigate to="/dashboard/studio/email/templates/new" replace />} />
                <Route path="blog/email-templates/:id" element={<StudioRedirect to="email/templates" />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LoginDialogProvider>
  );
}
