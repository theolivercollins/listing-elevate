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
import Upload from "./pages/Upload";
import Presets from "./pages/Presets";
import Status from "./pages/Status";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
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
import DashboardClients from "./pages/dashboard/Clients";
import DashboardClientNew from "./pages/dashboard/ClientNew";
import DashboardCustomListingNew from "./pages/dashboard/CustomListingNew";
import DashboardOrders from "./pages/dashboard/Orders";
import DashboardOrderNew from "./pages/dashboard/OrderNew";
import DashboardOrderDetail from "./pages/dashboard/OrderDetail";
import Onboard from "./pages/Onboard";
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
            <TopNav />
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/status/:id" element={<Status />} />
              <Route path="/onboard/:token" element={<Onboard />} />

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
                  <Route path="finances" element={<DashboardFinances />} />
                  <Route path="settings" element={<DashboardSettings />} />
                  <Route path="clients" element={<DashboardClients />} />
                  <Route path="clients/new" element={<DashboardClientNew />} />
                  <Route path="clients/:id" element={<DashboardClientNew />} />
                  <Route path="listings/new" element={<DashboardCustomListingNew />} />
                  <Route path="orders" element={<DashboardOrders />} />
                  <Route path="orders/new" element={<DashboardOrderNew />} />
                  <Route path="orders/:id" element={<DashboardOrderDetail />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
