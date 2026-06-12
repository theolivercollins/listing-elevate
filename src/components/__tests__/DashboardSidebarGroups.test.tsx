/**
 * DashboardSidebar — operator group structure tests (B nav regroup).
 *
 * Verifies that the admin branch has exactly 3 section groups:
 *   Operate  → Today, Orders, Listings, Agents
 *   Studio   → Video, Blog, Email
 *   Business → Finances, Logs, System status, Lab, Settings
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Shared mock auth state ─────────────────────────────────────────────────────
const mockAuthValue = {
  user: { id: "admin-user" },
  profile: { role: "admin" as "admin" | "user", first_name: "Oliver" },
  session: {},
  loading: false,
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuthValue,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  AUTH_CALLBACK_URL: "http://localhost/auth/callback",
}));

vi.mock("@/lib/api", () => ({
  fetchLogs: vi.fn().mockResolvedValue({ logs: [] }),
  fetchProperties: vi.fn().mockResolvedValue({ properties: [], total: 0 }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

import { getSections, DashboardSidebar } from "@/components/DashboardSidebar";

function wrap(collapsed = false) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <DashboardSidebar collapsed={collapsed} onToggleCollapsed={vi.fn()} />
    </MemoryRouter>
  );
}

// ── getSections unit tests ─────────────────────────────────────────────────────
describe("getSections — operator (admin) group structure", () => {
  it("returns exactly 3 sections for admin", () => {
    const sections = getSections("admin");
    expect(sections).toHaveLength(3);
  });

  it("first section is named 'Operate'", () => {
    const sections = getSections("admin");
    expect(sections[0].label).toBe("Operate");
  });

  it("second section is named 'Studio'", () => {
    const sections = getSections("admin");
    expect(sections[1].label).toBe("Studio");
  });

  it("third section is named 'Business'", () => {
    const sections = getSections("admin");
    expect(sections[2].label).toBe("Business");
  });

  it("Operate section has Today item pointing to /dashboard (landing)", () => {
    const sections = getSections("admin");
    const operate = sections[0];
    const today = operate.items.find((i) => i.label === "Today");
    expect(today).toBeDefined();
    expect(today?.to).toBe("/dashboard");
  });

  it("Operate section has Orders item pointing to /dashboard/pipeline", () => {
    const sections = getSections("admin");
    const operate = sections[0];
    const orders = operate.items.find((i) => i.label === "Orders");
    expect(orders).toBeDefined();
    expect(orders?.to).toBe("/dashboard/pipeline");
  });

  it("Operate section has Listings item pointing to /dashboard/properties", () => {
    const sections = getSections("admin");
    const operate = sections[0];
    const listings = operate.items.find((i) => i.label === "Listings");
    expect(listings).toBeDefined();
    expect(listings?.to).toBe("/dashboard/properties");
  });

  it("Operate section has Agents item pointing to /dashboard/users", () => {
    const sections = getSections("admin");
    const operate = sections[0];
    const agents = operate.items.find((i) => i.label === "Agents");
    expect(agents).toBeDefined();
    expect(agents?.to).toBe("/dashboard/users");
  });

  it("Studio section has Video, Blog, Email items", () => {
    const sections = getSections("admin");
    const studio = sections[1];
    const labels = studio.items.map((i) => i.label);
    expect(labels).toContain("Video");
    expect(labels).toContain("Blog");
    expect(labels).toContain("Email");
  });

  it("Business section contains Finances, Logs, System status, Lab, Settings", () => {
    const sections = getSections("admin");
    const business = sections[2];
    const labels = business.items.map((i) => i.label);
    expect(labels).toContain("Finances");
    expect(labels).toContain("Logs");
    expect(labels).toContain("System status");
    expect(labels).toContain("Lab");
    expect(labels).toContain("Settings");
  });

  it("does NOT have legacy 'Workspace' or 'Ops' section labels", () => {
    const sections = getSections("admin");
    const sectionLabels = sections.map((s) => s.label);
    expect(sectionLabels).not.toContain("Workspace");
    expect(sectionLabels).not.toContain("Ops");
  });

  it("does NOT have legacy 'Pipeline' or 'Users' or 'Overview' item labels in admin nav", () => {
    const sections = getSections("admin");
    const allLabels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(allLabels).not.toContain("Pipeline");
    expect(allLabels).not.toContain("Users");
    expect(allLabels).not.toContain("Overview");
  });
});

// ── getSections — agent (non-admin) nav is unchanged ──────────────────────────
describe("getSections — agent (non-admin) nav unchanged", () => {
  it("returns 1 section for non-admin", () => {
    const sections = getSections("user");
    expect(sections).toHaveLength(1);
  });

  it("agent sections still include Home, Order a video", () => {
    const sections = getSections("user");
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Home");
    expect(labels.some((l) => l.toLowerCase().includes("order"))).toBe(true);
  });
});

// ── REGRESSION: agent nav must NOT contain operator-only routes ────────────────
describe("getSections — agent nav role-split boundary (no operator leak)", () => {
  /**
   * Operator-only route prefixes that must NEVER appear in agent nav.
   */
  const OPERATOR_ONLY_PREFIXES = [
    "/dashboard/users",
    "/dashboard/logs",
    "/dashboard/finances",
    "/dashboard/pipeline",
    "/dashboard/properties",
    "/dashboard/system",
    "/dashboard/lab",
    "/dashboard/learning",
    "/dashboard/blog",
    "/dashboard/email",
    "/dashboard/market-update",
    "/dashboard/development", // labs & system status live here
    "/dashboard/studio", // operator-only video & blog editing
  ];

  /**
   * Agent-allowed routes — the 5 items in AGENT_SECTIONS.
   */
  const AGENT_ALLOWED_ROUTES = [
    "/dashboard", // Home
    "/upload", // Order a video
    "/dashboard/account/listings", // My listings
    "/dashboard/account/billing", // Billing
    "/dashboard/account/profile", // Profile
  ];

  it("agent nav contains ZERO operator-only routes", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));

    // Assert: none of the agent routes start with an operator-only prefix
    const operatorLeaks = agentRoutes.filter((route) =>
      OPERATOR_ONLY_PREFIXES.some((prefix) => route.startsWith(prefix))
    );

    expect(operatorLeaks).toEqual(
      [],
      `Agent nav leaked operator routes: ${operatorLeaks.join(", ")}`
    );
  });

  it("agent nav routes are exactly the allowed set", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to)).sort();
    const allowedRoutes = AGENT_ALLOWED_ROUTES.sort();

    expect(agentRoutes).toEqual(
      allowedRoutes,
      "Agent nav routes must match the exact allowed set"
    );
  });

  it("operator nav DOES contain operator routes (sanity check)", () => {
    const operatorSections = getSections("admin");
    const operatorRoutes = operatorSections.flatMap((s) => s.items.map((i) => i.to));

    // Spot-check: /dashboard/users (Agents) must be present
    expect(operatorRoutes).toContain(
      "/dashboard/users",
      "Operator nav must include /dashboard/users"
    );

    // Spot-check: /dashboard/pipeline (Orders) must be present
    expect(operatorRoutes).toContain(
      "/dashboard/pipeline",
      "Operator nav must include /dashboard/pipeline"
    );

    // Spot-check: /dashboard/finances must be present
    expect(operatorRoutes).toContain(
      "/dashboard/finances",
      "Operator nav must include /dashboard/finances"
    );

    // Spot-check: /dashboard/logs must be present
    expect(operatorRoutes).toContain(
      "/dashboard/logs",
      "Operator nav must include /dashboard/logs"
    );
  });

  it("agent nav does NOT contain /dashboard/users (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    expect(agentRoutes).not.toContain("/dashboard/users");
  });

  it("agent nav does NOT contain /dashboard/logs (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    expect(agentRoutes).not.toContain("/dashboard/logs");
  });

  it("agent nav does NOT contain /dashboard/finances (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    expect(agentRoutes).not.toContain("/dashboard/finances");
  });

  it("agent nav does NOT contain /dashboard/pipeline (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    expect(agentRoutes).not.toContain("/dashboard/pipeline");
  });

  it("agent nav does NOT contain /dashboard/properties (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    expect(agentRoutes).not.toContain("/dashboard/properties");
  });

  it("agent nav does NOT contain /dashboard/studio routes (operator-only)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    const studioRoutes = agentRoutes.filter((r) => r.startsWith("/dashboard/studio"));
    expect(studioRoutes).toEqual([], "Agent nav must not contain /dashboard/studio routes");
  });

  it("agent nav does NOT contain /dashboard/development routes (operator-only lab/system)", () => {
    const agentSections = getSections("user");
    const agentRoutes = agentSections.flatMap((s) => s.items.map((i) => i.to));
    const devRoutes = agentRoutes.filter((r) => r.startsWith("/dashboard/development"));
    expect(devRoutes).toEqual(
      [],
      "Agent nav must not contain /dashboard/development routes"
    );
  });
});

// ── Rendered sidebar — 3 group labels visible ─────────────────────────────────
describe("DashboardSidebar rendered — operator groups", () => {
  beforeEach(() => {
    mockAuthValue.profile = { role: "admin", first_name: "Oliver" };
  });

  it("renders 'Operate' section label in the sidebar", () => {
    const { container } = render(wrap());
    expect(container.textContent).toContain("Operate");
  });

  it("renders 'Studio' section label in the sidebar", () => {
    const { container } = render(wrap());
    expect(container.textContent).toContain("Studio");
  });

  it("renders 'Business' section label in the sidebar", () => {
    const { container } = render(wrap());
    expect(container.textContent).toContain("Business");
  });

  it("renders 'Today' nav item", () => {
    const { container } = render(wrap());
    const items = Array.from(container.querySelectorAll(".le-nav-item"));
    const labels = items.map((el) => el.textContent?.trim() ?? "");
    expect(labels.some((l) => l.includes("Today"))).toBe(true);
  });

  it("renders 'Orders' nav item (not 'Pipeline')", () => {
    const { container } = render(wrap());
    const items = Array.from(container.querySelectorAll(".le-nav-item"));
    const labels = items.map((el) => el.textContent?.trim() ?? "");
    expect(labels.some((l) => l.includes("Orders"))).toBe(true);
    expect(labels.some((l) => l === "Pipeline")).toBe(false);
  });

  it("renders 'Agents' nav item (not 'Users')", () => {
    const { container } = render(wrap());
    const items = Array.from(container.querySelectorAll(".le-nav-item"));
    const labels = items.map((el) => el.textContent?.trim() ?? "");
    expect(labels.some((l) => l.includes("Agents"))).toBe(true);
    expect(labels.some((l) => l === "Users")).toBe(false);
  });
});
