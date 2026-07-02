/**
 * Nav rename — routes still resolve after label rename (Task B).
 *
 * The sidebar labels changed (Pipeline→Orders, Users→Agents, Overview→Today)
 * but the ROUTES are unchanged. This test asserts that:
 * 1. /dashboard/pipeline still renders the Pipeline page (not redirected)
 * 2. /dashboard/users still renders the Users page (not redirected)
 * 3. /dashboard (index) still renders Overview for admin (Today landing)
 *
 * The getSections() data drives what URLs the sidebar links point to —
 * this test verifies the URLs in getSections match the live route tree.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock auth ──────────────────────────────────────────────────────────────────
const mockAuthValue = {
  user: { id: "admin-user-id" } as { id: string } | null,
  profile: { role: "admin" } as { role: string } | null,
  session: null,
  loading: false,
  adminVerified: true,
  sendAdminEmailCode: vi.fn(),
  verifyAdminEmailCode: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  AUTH_CALLBACK_URL: "http://localhost/auth/callback",
}));

// ── Mock heavy dashboard pages ─────────────────────────────────────────────────
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
vi.mock("@/pages/AgentHome", () => ({
  default: () => <div data-testid="agent-home">AgentHome</div>,
}));

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
}));

vi.mock("@/components/TopNav", () => ({
  TopNav: () => null,
}));
vi.mock("@/components/DashboardSidebar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/DashboardSidebar")>();
  return {
    ...real,
    DashboardSidebar: () => null,
    useDashboardSidebar: () => [false, vi.fn()],
  };
});
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

import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppRoutes from "../AppRoutes";
import { getSections } from "@/components/DashboardSidebar";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

function getTestIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-testid]")).map(
    (el) => el.getAttribute("data-testid"),
  );
}

// AppRoutes lazy-loads every dashboard page (feat/studio-perf) behind a
// Suspense boundary, so page content mounts asynchronously even with the
// module mocked below — assertions must `waitFor` it rather than read the
// DOM synchronously right after `render()`.

describe("Nav rename — routes unchanged after label rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue.user = { id: "admin-user-id" };
    mockAuthValue.profile = { role: "admin" };
    mockAuthValue.adminVerified = true;
  });

  it("/dashboard/pipeline still renders Pipeline (sidebar label is now 'Orders')", async () => {
    const { container } = renderAt("/dashboard/pipeline");
    await waitFor(() => {
      expect(getTestIds(container)).toContain("page-pipeline");
    });
  });

  it("/dashboard/users still renders Users (sidebar label is now 'Agents')", async () => {
    const { container } = renderAt("/dashboard/users");
    await waitFor(() => {
      expect(getTestIds(container)).toContain("page-users");
    });
  });

  it("/dashboard still renders Overview for admin (sidebar label is now 'Today')", async () => {
    const { container } = renderAt("/dashboard");
    await waitFor(() => {
      expect(getTestIds(container)).toContain("page-overview");
    });
  });

  it("/dashboard/properties still renders Properties page", async () => {
    const { container } = renderAt("/dashboard/properties");
    await waitFor(() => {
      expect(getTestIds(container)).toContain("page-properties");
    });
  });

  it("/dashboard/finances still renders Finances page", async () => {
    const { container } = renderAt("/dashboard/finances");
    await waitFor(() => {
      expect(getTestIds(container)).toContain("page-finances");
    });
  });
});

describe("getSections — URL targets match AppRoutes paths", () => {
  it("Orders item targets /dashboard/pipeline which is a real route", () => {
    const sections = getSections("admin");
    const operate = sections.find((s) => s.label === "Operate");
    const orders = operate?.items.find((i) => i.label === "Orders");
    expect(orders?.to).toBe("/dashboard/pipeline");
  });

  it("Agents item targets /dashboard/users which is a real route", () => {
    const sections = getSections("admin");
    const operate = sections.find((s) => s.label === "Operate");
    const agents = operate?.items.find((i) => i.label === "Agents");
    expect(agents?.to).toBe("/dashboard/users");
  });

  it("Today item targets /dashboard which is the operator landing", () => {
    const sections = getSections("admin");
    const operate = sections.find((s) => s.label === "Operate");
    const today = operate?.items.find((i) => i.label === "Today");
    expect(today?.to).toBe("/dashboard");
  });

  it("System status item targets /dashboard/development/system-status", () => {
    const sections = getSections("admin");
    const business = sections.find((s) => s.label === "Business");
    const sysStatus = business?.items.find((i) => i.label === "System status");
    expect(sysStatus?.to).toBe("/dashboard/development/system-status");
  });
});
