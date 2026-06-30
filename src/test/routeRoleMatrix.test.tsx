/**
 * Route × Role Matrix Test
 *
 * Verifies the role-based routing requirements for the authed-app-role-split:
 * - Non-admin (agent): /dashboard → AgentHome, /dashboard/account/* → renders, operator routes → /dashboard
 * - Admin (operator): all routes including operator-only ones → render
 *
 * Uses MemoryRouter + mocked auth + mocked heavy pages to keep the test fast.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock the auth module ────────────────────────────────────────────────────
const mockAuthValue = {
  user: null as { id: string } | null,
  profile: null as { role: string } | null,
  session: null,
  loading: false,
  mfaRequired: false,
  mfaVerifiedFactors: [] as unknown[],
  completeMfaChallenge: vi.fn(),
  refreshMfaFactors: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Mock supabase to prevent real network calls ─────────────────────────────
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  AUTH_CALLBACK_URL: "http://localhost/auth/callback",
}));

// ── Mock heavy dashboard pages to avoid deep import trees ──────────────────
vi.mock("@/pages/dashboard/Overview", () => ({
  default: () => <div data-testid="page-overview">Overview</div>,
}));
vi.mock("@/pages/dashboard/Pipeline", () => ({
  default: () => <div data-testid="page-pipeline">Pipeline</div>,
}));
vi.mock("@/pages/dashboard/Finances", () => ({
  default: () => <div data-testid="page-finances">Finances</div>,
}));
vi.mock("@/pages/dashboard/Users", () => ({
  default: () => <div data-testid="page-users">Users</div>,
}));
vi.mock("@/pages/dashboard/Properties", () => ({
  default: () => <div data-testid="page-properties">Properties</div>,
}));
vi.mock("@/pages/dashboard/Logs", () => ({
  default: () => <div data-testid="page-logs">Logs</div>,
}));
vi.mock("@/pages/dashboard/RatingLedger", () => ({
  default: () => <div data-testid="page-rating-ledger">RatingLedger</div>,
}));
vi.mock("@/pages/dashboard/Settings", () => ({
  default: () => <div data-testid="page-settings">Settings</div>,
}));
vi.mock("@/pages/dashboard/Development", () => ({
  default: () => <div data-testid="page-development">Development</div>,
}));
vi.mock("@/pages/dashboard/account/Profile", () => ({
  default: () => <div data-testid="page-profile">Profile</div>,
}));
vi.mock("@/pages/dashboard/account/Billing", () => ({
  default: () => <div data-testid="page-billing">Billing</div>,
}));
vi.mock("@/pages/dashboard/account/Listings", () => ({
  default: () => <div data-testid="page-listings">Listings</div>,
}));
// Operator studio pages
vi.mock("@/pages/dashboard/studio/StudioHome", () => ({
  default: () => <div data-testid="page-studio-home">StudioHome</div>,
}));
vi.mock("@/pages/dashboard/studio/StudioNew", () => ({
  default: () => <div data-testid="page-studio-new">StudioNew</div>,
}));
vi.mock("@/pages/dashboard/studio/Clients", () => ({
  default: () => <div data-testid="page-studio-clients">StudioClients</div>,
}));
vi.mock("@/pages/dashboard/studio/ClientEdit", () => ({
  default: () => <div data-testid="page-studio-client-edit">StudioClientEdit</div>,
}));
vi.mock("@/pages/dashboard/studio/PropertyCommandCenter", () => ({
  default: () => <div data-testid="page-studio-pcc">StudioPCC</div>,
}));
// Blog/email pages
vi.mock("@/pages/dashboard/BlogPostsList", () => ({
  default: () => <div data-testid="page-blog-posts">BlogPostsList</div>,
}));
vi.mock("@/pages/dashboard/BlogPostDetail", () => ({
  default: () => <div data-testid="page-blog-detail">BlogPostDetail</div>,
}));
vi.mock("@/pages/dashboard/BlogAllyHistory", () => ({
  default: () => <div data-testid="page-blog-ally">BlogAllyHistory</div>,
}));
vi.mock("@/pages/dashboard/BlogImageLibrary", () => ({
  default: () => <div data-testid="page-blog-images">BlogImageLibrary</div>,
}));
vi.mock("@/pages/dashboard/BlogTemplates", () => ({
  default: () => <div data-testid="page-blog-templates">BlogTemplates</div>,
}));
vi.mock("@/pages/dashboard/MarketUpdate", () => ({
  default: () => <div data-testid="page-market-update">MarketUpdate</div>,
}));
vi.mock("@/pages/dashboard/BlogTemplateDetail", () => ({
  default: () => <div data-testid="page-blog-template-detail">BlogTemplateDetail</div>,
}));
vi.mock("@/pages/dashboard/EmailsList", () => ({
  default: () => <div data-testid="page-emails">EmailsList</div>,
}));
vi.mock("@/pages/dashboard/EmailDetail", () => ({
  default: () => <div data-testid="page-email-detail">EmailDetail</div>,
}));
vi.mock("@/pages/dashboard/EmailTemplates", () => ({
  default: () => <div data-testid="page-email-templates">EmailTemplates</div>,
}));
vi.mock("@/pages/dashboard/EmailTemplateDetail", () => ({
  default: () => <div data-testid="page-email-template-detail">EmailTemplateDetail</div>,
}));
// Learning/lab pages
vi.mock("@/pages/dashboard/Learning", () => ({
  default: () => <div data-testid="page-learning">Learning</div>,
}));
vi.mock("@/pages/dashboard/PromptLab", () => ({
  default: () => <div data-testid="page-prompt-lab">PromptLab</div>,
}));
vi.mock("@/pages/dashboard/PromptLabRecipes", () => ({
  default: () => <div data-testid="page-prompt-lab-recipes">PromptLabRecipes</div>,
}));
vi.mock("@/pages/dashboard/PromptProposals", () => ({
  default: () => <div data-testid="page-prompt-proposals">PromptProposals</div>,
}));
vi.mock("@/pages/dashboard/KnowledgeMap", () => ({
  default: () => <div data-testid="page-knowledge-map">KnowledgeMap</div>,
}));
vi.mock("@/pages/dashboard/KnowledgeMapCell", () => ({
  default: () => <div data-testid="page-knowledge-map-cell">KnowledgeMapCell</div>,
}));
vi.mock("@/pages/dashboard/SystemStatus", () => ({
  default: () => <div data-testid="page-system-status">SystemStatus</div>,
}));
vi.mock("@/pages/dashboard/LabListings", () => ({
  default: () => <div data-testid="page-lab-listings">LabListings</div>,
}));
vi.mock("@/pages/dashboard/LabListingNew", () => ({
  default: () => <div data-testid="page-lab-listing-new">LabListingNew</div>,
}));
vi.mock("@/pages/dashboard/LabListingDetail", () => ({
  default: () => <div data-testid="page-lab-listing-detail">LabListingDetail</div>,
}));
// Other top-level pages
vi.mock("@/pages/dashboard/PropertyDetail", () => ({
  default: () => <div data-testid="page-property-detail">PropertyDetail</div>,
}));
vi.mock("@/pages/Upload", () => ({
  default: () => <div data-testid="page-upload">Upload</div>,
}));
vi.mock("@/pages/Presets", () => ({
  default: () => <div data-testid="page-presets">Presets</div>,
}));
vi.mock("@/pages/Index", () => ({
  default: () => <div data-testid="page-index">Index</div>,
}));
vi.mock("@/pages/Status", () => ({
  default: () => <div data-testid="page-status">Status</div>,
}));
vi.mock("@/pages/AuthCallback", () => ({
  default: () => <div data-testid="page-auth-callback">AuthCallback</div>,
}));
vi.mock("@/pages/NotFound", () => ({
  default: () => <div data-testid="page-not-found">NotFound</div>,
}));
vi.mock("@/pages/UploadSuccess", () => ({
  default: () => <div data-testid="page-upload-success">UploadSuccess</div>,
}));
vi.mock("@/pages/UploadCancelled", () => ({
  default: () => <div data-testid="page-upload-cancelled">UploadCancelled</div>,
}));
vi.mock("@/v2/pages/Landing", () => ({
  default: () => <div data-testid="v2-landing-root">Landing</div>,
}));
vi.mock("@/pages/preview/PreviewPage", () => ({
  default: () => <div data-testid="page-preview">PreviewPage</div>,
}));
vi.mock("@/pages/share/Presentation", () => ({
  default: () => <div data-testid="page-share-presentation">SharePresentation</div>,
}));
vi.mock("@/pages/share/Embed", () => ({
  default: () => <div data-testid="page-share-embed">ShareEmbed</div>,
}));
vi.mock("@/pages/dashboard/studio/Share", () => ({
  default: () => <div data-testid="page-studio-share">StudioShare</div>,
}));

// ── Mock Dashboard shell to just render the Outlet ─────────────────────────
vi.mock("@/pages/Dashboard", () => ({
  default: ({ children }: { children?: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Outlet } = require("react-router-dom");
    return (
      <div data-testid="dashboard-shell">
        <Outlet />
        {children}
      </div>
    );
  },
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a {...props}>{children}</a>
  ),
}));

// ── Suppress noisy TopNav/Sidebar imports ──────────────────────────────────
vi.mock("@/components/TopNav", () => ({
  TopNav: () => null,
}));
vi.mock("@/components/DashboardSidebar", () => ({
  DashboardSidebar: () => null,
  useDashboardSidebar: () => [false, vi.fn()],
}));
vi.mock("@/components/ScrollToTop", () => ({
  ScrollToTop: () => null,
}));
vi.mock("@/v2/components/auth/LoginDialogContext", () => ({
  LoginDialogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/theme", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Import App after mocks are set ─────────────────────────────────────────
import React from "react";
import AppRoutes from "../AppRoutes";

// Helper: render the route tree with MemoryRouter at a given path
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

// Helper: get the current pathname from the location object as rendered
// We detect redirect by looking for specific test IDs
function getTestIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-testid]")).map(
    (el) => el.getAttribute("data-testid")
  );
}

describe("Route × Role Matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Unauthenticated user", () => {
    beforeEach(() => {
      mockAuthValue.user = null;
      mockAuthValue.profile = null;
      mockAuthValue.loading = false;
    });

    it("/dashboard redirects to /login (unauthenticated)", () => {
      const { container } = renderAt("/dashboard");
      // Should see landing or login redirect, not the dashboard
      const ids = getTestIds(container);
      expect(ids).not.toContain("dashboard-shell");
      expect(ids).not.toContain("page-overview");
      expect(ids).not.toContain("agent-home");
    });
  });

  describe("Non-admin (agent) user", () => {
    beforeEach(() => {
      mockAuthValue.user = { id: "agent-user-id" };
      mockAuthValue.profile = { role: "user" };
      mockAuthValue.loading = false;
    });

    it("/dashboard renders AgentHome (not Overview)", () => {
      const { container } = renderAt("/dashboard");
      const ids = getTestIds(container);
      expect(ids).toContain("agent-home");
      expect(ids).not.toContain("page-overview");
    });

    it("/dashboard/account/profile renders without redirect loop", () => {
      const { container } = renderAt("/dashboard/account/profile");
      const ids = getTestIds(container);
      expect(ids).toContain("page-profile");
    });

    it("/dashboard/account/billing renders", () => {
      const { container } = renderAt("/dashboard/account/billing");
      const ids = getTestIds(container);
      expect(ids).toContain("page-billing");
    });

    it("/dashboard/pipeline redirects to /dashboard (not /account loop)", () => {
      const { container } = renderAt("/dashboard/pipeline");
      const ids = getTestIds(container);
      // Should show AgentHome (because we redirected to /dashboard)
      expect(ids).toContain("agent-home");
      expect(ids).not.toContain("page-pipeline");
    });

    it("/dashboard/finances redirects to /dashboard", () => {
      const { container } = renderAt("/dashboard/finances");
      const ids = getTestIds(container);
      expect(ids).toContain("agent-home");
      expect(ids).not.toContain("page-finances");
    });

    it("/dashboard/users redirects to /dashboard", () => {
      const { container } = renderAt("/dashboard/users");
      const ids = getTestIds(container);
      expect(ids).toContain("agent-home");
      expect(ids).not.toContain("page-users");
    });
  });

  describe("Admin (operator) user", () => {
    beforeEach(() => {
      mockAuthValue.user = { id: "admin-user-id" };
      mockAuthValue.profile = { role: "admin" };
      mockAuthValue.loading = false;
    });

    it("/dashboard renders Overview (operator landing)", () => {
      const { container } = renderAt("/dashboard");
      const ids = getTestIds(container);
      expect(ids).toContain("page-overview");
      expect(ids).not.toContain("agent-home");
    });

    it("/dashboard/pipeline renders", () => {
      const { container } = renderAt("/dashboard/pipeline");
      const ids = getTestIds(container);
      expect(ids).toContain("page-pipeline");
    });

    it("/dashboard/finances renders", () => {
      const { container } = renderAt("/dashboard/finances");
      const ids = getTestIds(container);
      expect(ids).toContain("page-finances");
    });

    it("/dashboard/users renders", () => {
      const { container } = renderAt("/dashboard/users");
      const ids = getTestIds(container);
      expect(ids).toContain("page-users");
    });

    it("/dashboard/account/profile renders", () => {
      const { container } = renderAt("/dashboard/account/profile");
      const ids = getTestIds(container);
      expect(ids).toContain("page-profile");
    });
  });
});
