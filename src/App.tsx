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
import UploadSuccess from "./pages/UploadSuccess";
import UploadCancelled from "./pages/UploadCancelled";
import Presets from "./pages/Presets";
import Status from "./pages/Status";
import AuthCallback from "./pages/AuthCallback";
import { LoginDialogProvider } from "@/v2/components/auth/LoginDialogContext";
import DashboardAccountProfile from "./pages/dashboard/account/Profile";
import DashboardAccountBilling from "./pages/dashboard/account/Billing";
import DashboardAccountListings from "./pages/dashboard/account/Listings";
import Dashboard from "./pages/Dashboard";
import DashboardOverview from "./pages/dashboard/Overview";
import DashboardPipeline from "./pages/dashboard/Pipeline";
import DashboardProperties from "./pages/dashboard/Properties";
import PropertyDetail from "./pages/dashboard/PropertyDetail";
import DashboardLogs from "./pages/dashboard/Logs";
import DashboardFinances from "./pages/dashboard/Finances";
import DashboardSettings from "./pages/dashboard/Settings";
import DashboardUsers from "./pages/dashboard/Users";
import DashboardDevelopment from "./pages/dashboard/Development";
import DashboardLearning from "./pages/dashboard/Learning";
import DashboardPromptLab from "./pages/dashboard/PromptLab";
import DashboardPromptLabRecipes from "./pages/dashboard/PromptLabRecipes";
import DashboardPromptProposals from "./pages/dashboard/PromptProposals";
import DashboardKnowledgeMap from "./pages/dashboard/KnowledgeMap";
import DashboardKnowledgeMapCell from "./pages/dashboard/KnowledgeMapCell";
import DashboardSystemStatus from "./pages/dashboard/SystemStatus";
import DashboardLabListings from "./pages/dashboard/LabListings";
import DashboardLabListingNew from "./pages/dashboard/LabListingNew";
import DashboardLabListingDetail from "./pages/dashboard/LabListingDetail";
import DashboardRatingLedger from "./pages/dashboard/RatingLedger";
import BlogPostsList from "./pages/dashboard/BlogPostsList";
import BlogPostDetail from "./pages/dashboard/BlogPostDetail";
import BlogAllyHistory from "./pages/dashboard/BlogAllyHistory";
import BlogImageLibrary from "./pages/dashboard/BlogImageLibrary";
import BlogTemplates from "./pages/dashboard/BlogTemplates";
import MarketUpdate from "./pages/dashboard/MarketUpdate";
import BlogTemplateDetail from "./pages/dashboard/BlogTemplateDetail";
import EmailsList from "./pages/dashboard/EmailsList";
import EmailDetail from "./pages/dashboard/EmailDetail";
import EmailTemplates from "./pages/dashboard/EmailTemplates";
import EmailTemplateDetail from "./pages/dashboard/EmailTemplateDetail";
import StudioHome from "./pages/dashboard/studio/StudioHome";
import StudioNew from "./pages/dashboard/studio/StudioNew";
import StudioClients from "./pages/dashboard/studio/Clients";
import StudioClientEdit from "./pages/dashboard/studio/ClientEdit";
import StudioPropertyCommandCenter from "./pages/dashboard/studio/PropertyCommandCenter";
import StudioShare from "./pages/dashboard/studio/Share";
import StudioVideos from "./pages/dashboard/studio/Videos";
import StudioVideoHub from "./pages/dashboard/studio/VideoHub";
import SharePresentation from "./pages/share/Presentation";
import ShareEmbed from "./pages/share/Embed";
import PreviewPage from "./pages/preview/PreviewPage";
import EmbedPage from "./pages/preview/EmbedPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function StudioRedirect({ to }: { to: string }) {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/dashboard/studio/${to}/${id ?? ""}`} replace />;
}

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
                {/* LE Video embed — more-specific path MUST be above the bare token route */}
                <Route path="/preview/:token/embed" element={<EmbedPage />} />
                <Route path="/preview/:token" element={<PreviewPage />} />
                {/* Public Vimeo-style share viewer (presentation + embed) */}
                <Route path="/v/:token" element={<SharePresentation />} />
                <Route path="/embed/:token" element={<ShareEmbed />} />

                {/* Backwards-compat redirects for old /account/* bookmarks */}
                <Route path="/account" element={<Navigate to="/dashboard/account/profile" replace />} />
                <Route path="/account/profile" element={<Navigate to="/dashboard/account/profile" replace />} />
                <Route path="/account/billing" element={<Navigate to="/dashboard/account/billing" replace />} />
                <Route path="/account/properties" element={<Navigate to="/dashboard/account/listings" replace />} />

                {/* Stripe Checkout redirect targets — public so Stripe can land here */}
                <Route path="/upload/success" element={<UploadSuccess />} />
                <Route path="/upload/cancelled" element={<UploadCancelled />} />

                {/* Authenticated user routes */}
                <Route element={<RequireAuth />}>
                  <Route path="/upload" element={<Upload />} />
                  <Route path="/presets" element={<Presets />} />
                </Route>

                {/* Admin routes */}
                <Route element={<RequireAdmin />}>
                  <Route path="/dashboard" element={<Dashboard />}>
                    <Route index element={<DashboardOverview />} />
                    <Route path="pipeline" element={<DashboardPipeline />} />
                    <Route path="properties" element={<DashboardProperties />} />
                    <Route path="properties/:id" element={<PropertyDetail />} />
                    <Route path="logs" element={<DashboardLogs />} />
                    <Route path="development" element={<DashboardDevelopment />} />
                    <Route path="development/learning" element={<DashboardLearning />} />
                    <Route path="development/prompt-lab" element={<DashboardPromptLab />} />
                    <Route path="development/prompt-lab/recipes" element={<DashboardPromptLabRecipes />} />
                    <Route path="development/prompt-lab/:sessionId" element={<DashboardPromptLab />} />
                    <Route path="development/proposals" element={<DashboardPromptProposals />} />
                    <Route path="development/knowledge-map" element={<DashboardKnowledgeMap />} />
                    <Route path="development/knowledge-map/:cellKey" element={<DashboardKnowledgeMapCell />} />
                    <Route path="development/system-status" element={<DashboardSystemStatus />} />
                    <Route path="development/lab" element={<DashboardLabListings />} />
                    <Route path="development/lab/new" element={<DashboardLabListingNew />} />
                    <Route path="development/lab/:id" element={<DashboardLabListingDetail />} />
                    <Route path="rating-ledger" element={<DashboardRatingLedger />} />
                    <Route path="finances" element={<DashboardFinances />} />
                    <Route path="users" element={<DashboardUsers />} />
                    <Route path="settings" element={<DashboardSettings />} />

                    {/* Video / Blog / Email — three separate sidebar tabs, URLs preserved */}
                    <Route path="studio">
                      <Route index element={<Navigate to="video" replace />} />

                      {/* Video */}
                      <Route path="video" element={<StudioHome />} />
                      <Route path="video/new" element={<StudioNew />} />
                      <Route path="video/clients" element={<StudioClients />} />
                      <Route path="video/share" element={<StudioShare />} />
                      <Route path="video/clients/:id" element={<StudioClientEdit />} />
                      <Route path="video/properties/:id" element={<StudioPropertyCommandCenter />} />

                      {/* LE Video library + hub (spec §1/§2) */}
                      <Route path="videos" element={<StudioVideos />} />
                      <Route path="videos/:propertyId" element={<StudioVideoHub />} />

                      {/* Blog */}
                      <Route path="blog" element={<Navigate to="posts" replace />} />
                      <Route path="blog/posts" element={<BlogPostsList />} />
                      <Route path="blog/market-update" element={<MarketUpdate />} />
                      <Route path="blog/posts/new" element={<BlogPostDetail />} />
                      <Route path="blog/posts/:id" element={<BlogPostDetail />} />
                      <Route path="blog/ally-history" element={<BlogAllyHistory />} />
                      <Route path="blog/images" element={<BlogImageLibrary />} />
                      <Route path="blog/templates" element={<BlogTemplates />} />
                      <Route path="blog/templates/new" element={<BlogTemplateDetail />} />
                      <Route path="blog/templates/:id" element={<BlogTemplateDetail />} />

                      {/* Email */}
                      <Route path="email" element={<Navigate to="messages" replace />} />
                      <Route path="email/messages" element={<EmailsList />} />
                      <Route path="email/messages/new" element={<EmailDetail />} />
                      <Route path="email/messages/:id" element={<EmailDetail />} />
                      <Route path="email/templates" element={<EmailTemplates />} />
                      <Route path="email/templates/new" element={<EmailTemplateDetail />} />
                      <Route path="email/templates/:id" element={<EmailTemplateDetail />} />
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
                    <Route path="account">
                      <Route index element={<Navigate to="profile" replace />} />
                      <Route path="profile" element={<DashboardAccountProfile />} />
                      <Route path="billing" element={<DashboardAccountBilling />} />
                      <Route path="listings" element={<DashboardAccountListings />} />
                    </Route>
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
