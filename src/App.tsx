import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
import Account from "./pages/Account";
import AccountProperties from "./pages/account/Properties";
import AccountBilling from "./pages/account/Billing";
import AccountProfile from "./pages/account/Profile";
import Dashboard from "./pages/Dashboard";
import DashboardOverview from "./pages/dashboard/Overview";
import DashboardPipeline from "./pages/dashboard/Pipeline";
import DashboardProperties from "./pages/dashboard/Properties";
import PropertyDetail from "./pages/dashboard/PropertyDetail";
import DashboardLogs from "./pages/dashboard/Logs";
import DashboardFinances from "./pages/dashboard/Finances";
import DashboardSettings from "./pages/dashboard/Settings";
import DashboardDevelopment from "./pages/dashboard/Development";
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
import BlogImageLibrary from "./pages/dashboard/BlogImageLibrary";
import BlogTemplates from "./pages/dashboard/BlogTemplates";
import BlogTemplateDetail from "./pages/dashboard/BlogTemplateDetail";
import MusicLibrary from "./pages/dashboard/Music";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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

                {/* Stripe Checkout redirect targets — public so Stripe can land here */}
                <Route path="/upload/success" element={<UploadSuccess />} />
                <Route path="/upload/cancelled" element={<UploadCancelled />} />

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
                    <Route index element={<DashboardOverview />} />
                    <Route path="pipeline" element={<DashboardPipeline />} />
                    <Route path="properties" element={<DashboardProperties />} />
                    <Route path="properties/:id" element={<PropertyDetail />} />
                    <Route path="logs" element={<DashboardLogs />} />
                    <Route path="development" element={<DashboardDevelopment />} />
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
                    <Route path="blog/posts" element={<BlogPostsList />} />
                    <Route path="blog/posts/new" element={<BlogPostDetail />} />
                    <Route path="blog/posts/:id" element={<BlogPostDetail />} />
                    <Route path="blog/images" element={<BlogImageLibrary />} />
                    <Route path="blog/templates" element={<BlogTemplates />} />
                    <Route path="blog/templates/new" element={<BlogTemplateDetail />} />
                    <Route path="blog/templates/:id" element={<BlogTemplateDetail />} />
                    <Route path="music" element={<MusicLibrary />} />
                    <Route path="finances" element={<DashboardFinances />} />
                    <Route path="settings" element={<DashboardSettings />} />
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
