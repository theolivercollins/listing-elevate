/**
 * overview-degraded tests — TDD written before implementation.
 *
 * Success criteria:
 * D1. When fetchCostBreakdown rejects → Overview cost section renders degraded badge
 *     + retry button (by testid), NOT a '$0', NOT the EmptyState dashed border.
 * D2. When fetchCostBreakdown resolves with empty rows → Overview cost section renders
 *     EmptyState (dashed border, data-empty-icon), NOT the degraded badge.
 * D3. When fetchCostBreakdown rejects → Finances cost breakdown section renders
 *     degraded badge + retry button, NOT '$0' (via MoneyValue null path).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "op-001", email: "oliver@recasi.com" },
    profile: { role: "admin", first_name: "Oliver" },
    session: {},
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// ── Mock supabase ─────────────────────────────────────────────────────────────
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

// ── Mock finances lib (used by Finances.tsx) ───────────────────────────────────
vi.mock("@/lib/finances", () => ({
  listTokenPurchases: vi.fn().mockResolvedValue([]),
  listExpenses: vi.fn().mockResolvedValue([]),
  listRevenueEntries: vi.fn().mockResolvedValue([]),
  listCostEvents: vi.fn().mockResolvedValue([]),
  countDeliveredVideos: vi.fn().mockResolvedValue(0),
  listSubscriptions: vi.fn().mockResolvedValue([]),
}));

// ── Shared API mocks ──────────────────────────────────────────────────────────

const mockFetchCostBreakdown = vi.fn();
const mockFetchModelHealth = vi.fn();
const mockFetchProperties = vi.fn();
const mockFetchDailyStats = vi.fn();
const mockFetchStatsOverview = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchCostBreakdown: (...args: unknown[]) => mockFetchCostBreakdown(...args),
  fetchModelHealth: (...args: unknown[]) => mockFetchModelHealth(...args),
  fetchProperties: (...args: unknown[]) => mockFetchProperties(...args),
  fetchDailyStats: (...args: unknown[]) => mockFetchDailyStats(...args),
  fetchStatsOverview: (...args: unknown[]) => mockFetchStatsOverview(...args),
}));

// ── Default API stubs for non-cost fetches ────────────────────────────────────
function setupDefaultMocks() {
  mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
  mockFetchDailyStats.mockResolvedValue({ stats: [] });
  mockFetchStatsOverview.mockResolvedValue({
    completedToday: 0,
    inPipeline: 0,
    needsReview: 0,
    successRate: 1,
    avgProcessingMs: 0,
  });
  mockFetchModelHealth.mockResolvedValue({ rows: [] });
}

// ── Import components under test ──────────────────────────────────────────────
import Overview from "../Overview";
import Finances from "../Finances";

function wrapOverview() {
  return (
    <MemoryRouter>
      <Overview />
    </MemoryRouter>
  );
}

function wrapFinances() {
  return (
    <MemoryRouter>
      <Finances />
    </MemoryRouter>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Overview — degraded cost state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // D1: fetchCostBreakdown rejects → degraded badge rendered, not $0, not EmptyState
  it("D1: renders cost-degraded badge + retry when fetchCostBreakdown rejects", async () => {
    mockFetchCostBreakdown.mockRejectedValue(new Error("503 Service Unavailable"));

    render(wrapOverview());

    await waitFor(() => {
      // Badge must be visible
      expect(screen.getByTestId("cost-degraded-badge")).toBeTruthy();
    });

    // Retry button must be present
    expect(screen.getByTestId("cost-degraded-retry")).toBeTruthy();

    // The badge text must mention unavailability
    expect(screen.getByTestId("cost-degraded-badge").textContent).toMatch(
      /cost data unavailable/i,
    );

    // EmptyState (provider-mix-empty) must NOT be present — badge and EmptyState are mutually exclusive
    expect(screen.queryByTestId("provider-mix-empty")).toBeNull();
  });

  // D2: fetchCostBreakdown resolves with empty data → EmptyState shown, NOT degraded badge
  it("D2: renders EmptyState (not degraded badge) when fetchCostBreakdown resolves with no providers", async () => {
    mockFetchCostBreakdown.mockResolvedValue({
      byProvider: [],
      byModel: [],
      byScope: [],
      byStage: [],
    });

    render(wrapOverview());

    await waitFor(() => {
      // EmptyState for provider mix should appear
      expect(screen.getByTestId("provider-mix-empty")).toBeTruthy();
    });

    // NO degraded badge
    expect(screen.queryByTestId("cost-degraded-badge")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finances tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Finances — degraded cost breakdown state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // D3: fetchCostBreakdown rejects → Finances breakdown section shows degraded badge
  it("D3: renders cost-breakdown-degraded badge + retry when fetchCostBreakdown rejects", async () => {
    mockFetchCostBreakdown.mockRejectedValue(new Error("Network error"));

    render(wrapFinances());

    await waitFor(() => {
      expect(screen.getByTestId("breakdown-degraded-badge")).toBeTruthy();
    });

    expect(screen.getByTestId("breakdown-degraded-retry")).toBeTruthy();
    expect(screen.getByTestId("breakdown-degraded-badge").textContent).toMatch(
      /cost data unavailable/i,
    );

    // Verify there is no '$0.00' rendered for the cost breakdown section
    // (MoneyValue(null) renders '—', not '$0.00')
    const badge = screen.getByTestId("breakdown-degraded-badge");
    const card = badge.closest("div[style]");
    // card should not contain "$0.00" as a fabricated value
    expect(badge.textContent).not.toContain("$0.00");
  });

  // D4: fetchCostBreakdown resolves OK with empty rows → shows the "no cost events" empty message, not degraded badge
  it("D4: renders no degraded badge when fetchCostBreakdown resolves with empty rows", async () => {
    mockFetchCostBreakdown.mockResolvedValue({
      byProvider: [],
      byModel: [],
      byScope: [],
      byStage: [],
    });

    render(wrapFinances());

    await waitFor(() => {
      // Should show the "no cost events" text (existing empty state in Finances)
      expect(screen.queryByText(/No cost events in the last 30 days/i)).toBeTruthy();
    });

    // No degraded badge
    expect(screen.queryByTestId("breakdown-degraded-badge")).toBeNull();
  });
});
