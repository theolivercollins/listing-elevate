/**
 * DashboardSidebar role-based navigation tests — TDD, written before implementation.
 *
 * Verifies:
 * B1. Non-admin (agent/role="user") sees exactly 5 nav items
 * B2. Admin sees the operator nav set (more than 5 items)
 * B3. Agent sidebar brand sub-label reads "Client studio" (not a version string)
 * B4. Operator sidebar brand sub-label does NOT read "Client studio"
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Shared mock auth state ─────────────────────────────────────────────────
const mockAuthValue = {
  user: { id: "test-user" },
  profile: { role: "user" as "admin" | "user", first_name: "Alex" },
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

// Block the unread-count fetch that tries real network in useUnreadCount
vi.mock("@/lib/api", () => ({
  fetchLogs: vi.fn().mockResolvedValue({ logs: [] }),
  fetchProperties: vi.fn().mockResolvedValue({ properties: [], total: 0 }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

import { DashboardSidebar } from "@/components/DashboardSidebar";

function wrap(collapsed = false) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <DashboardSidebar collapsed={collapsed} onToggleCollapsed={vi.fn()} />
    </MemoryRouter>
  );
}

describe("DashboardSidebar — role-based navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Agent (role=user)", () => {
    beforeEach(() => {
      mockAuthValue.profile = { role: "user", first_name: "Alex" };
    });

    it("renders exactly 5 nav items for an agent", () => {
      const { container } = render(wrap());
      // Nav items have the .le-nav-item class
      const navItems = container.querySelectorAll(".le-nav-item");
      expect(navItems.length).toBe(5);
    });

    it("contains 'Home' nav item for agent", () => {
      const { container } = render(wrap());
      const navItems = Array.from(container.querySelectorAll(".le-nav-item"));
      const labels = navItems.map((el) => el.textContent?.trim() ?? "");
      expect(labels.some((l) => l.includes("Home"))).toBe(true);
    });

    it("contains 'Order a video' nav item for agent", () => {
      const { container } = render(wrap());
      const navItems = Array.from(container.querySelectorAll(".le-nav-item"));
      const labels = navItems.map((el) => el.textContent?.trim() ?? "");
      expect(labels.some((l) => l.toLowerCase().includes("order"))).toBe(true);
    });

    it("shows 'Client studio' as the brand sub-label for agents", () => {
      const { container } = render(wrap());
      expect(container.textContent).toContain("Client studio");
    });

    it("does NOT show a version string (v2.x) in the sidebar for agents", () => {
      const { container } = render(wrap());
      // Version strings like "v2.4" should not appear for agents
      expect(container.textContent).not.toMatch(/v\d+\.\d+/);
    });
  });

  describe("Operator (role=admin)", () => {
    beforeEach(() => {
      mockAuthValue.profile = { role: "admin", first_name: "Oliver" };
    });

    it("renders more than 5 nav items for an operator", () => {
      const { container } = render(wrap());
      const navItems = container.querySelectorAll(".le-nav-item");
      expect(navItems.length).toBeGreaterThan(5);
    });

    it("contains 'Overview' nav item for operator", () => {
      const { container } = render(wrap());
      const navItems = Array.from(container.querySelectorAll(".le-nav-item"));
      const labels = navItems.map((el) => el.textContent?.trim() ?? "");
      expect(labels.some((l) => l.includes("Overview"))).toBe(true);
    });

    it("does NOT show 'Client studio' in the sidebar for operators", () => {
      const { container } = render(wrap());
      expect(container.textContent).not.toContain("Client studio");
    });
  });
});
