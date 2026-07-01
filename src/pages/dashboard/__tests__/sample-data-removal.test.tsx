/**
 * Tests that Overview and Pipeline do NOT render SAMPLE_* content
 * when APIs return empty/null results.
 *
 * Ensures the SAMPLE_ACTIVITY and SAMPLE_PROVIDER_MIX sample-data
 * substitutions have been removed from Overview.tsx, and that
 * Pipeline shows empty states instead of sample data.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "test-admin" },
    profile: { role: "admin", first_name: "Test" },
    session: {},
    loading: false,
    adminVerified: true,
    sendAdminEmailCode: vi.fn(),
    verifyAdminEmailCode: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// ── Mock API — all calls return empty data ────────────────────────────────────
vi.mock("@/lib/api", () => ({
  fetchProperties: vi.fn().mockResolvedValue({ properties: [], total: 0 }),
  fetchDailyStats: vi.fn().mockResolvedValue({ stats: [] }),
  fetchStatsOverview: vi.fn().mockResolvedValue({
    completedToday: 0,
    inPipeline: 0,
    needsReview: 0,
    successRate: null,
    avgProcessingMs: null,
  }),
  fetchCostBreakdown: vi.fn().mockResolvedValue({ byProvider: [] }),
  fetchProperty: vi.fn().mockResolvedValue({ scenes: [] }),
  approveScene: vi.fn(),
  retryScene: vi.fn(),
  resubmitScene: vi.fn(),
  skipScene: vi.fn(),
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

// ── Known sample content strings to assert ABSENCE of ────────────────────────
// These are verbatim strings from SAMPLE_ACTIVITY and SAMPLE_PROVIDER_MIX
// in src/components/dashboard/sample-data.ts.
const SAMPLE_ACTIVITY_STRINGS = [
  "120 Greenwich St #34",
  "9540 Vista Verde · Scene 4",
  "412 Sycamore · Scene 7",
  "55 Pelican Cove · 24 photos",
  "Daily ceiling 92% reached",
  "744 Coastline Way",
  "Kling failover → Runway",
];

const SAMPLE_PROVIDER_MIX_STRINGS = [
  "Atlas (Kling 2.6 Pro)",
  "Kling 2.0",
];

// Note: "Anthropic" and "Other" could appear legitimately in the UI, so
// we only check for strings that are uniquely from sample data.

import Overview from "../Overview";
import Pipeline from "../Pipeline";

function wrap(Component: React.ComponentType) {
  return (
    <MemoryRouter>
      <Component />
    </MemoryRouter>
  );
}

describe("Overview — no SAMPLE_ACTIVITY or SAMPLE_PROVIDER_MIX content when APIs return empty", () => {
  it("renders without any SAMPLE_ACTIVITY strings", async () => {
    const { container } = render(wrap(Overview));
    // Wait for loading to complete
    await waitFor(() => {
      expect(container.querySelector("[class*='fade']") ?? container).toBeTruthy();
    });
    // Give React async effects time to settle
    await new Promise((r) => setTimeout(r, 50));

    const text = container.textContent ?? "";
    for (const sample of SAMPLE_ACTIVITY_STRINGS) {
      expect(text, `SAMPLE_ACTIVITY string "${sample}" should not appear`).not.toContain(sample);
    }
  });

  it("renders without any SAMPLE_PROVIDER_MIX strings when cost API returns empty", async () => {
    const { container } = render(wrap(Overview));
    await new Promise((r) => setTimeout(r, 50));

    const text = container.textContent ?? "";
    for (const sample of SAMPLE_PROVIDER_MIX_STRINGS) {
      expect(text, `SAMPLE_PROVIDER_MIX string "${sample}" should not appear`).not.toContain(sample);
    }
  });
});

describe("Pipeline — no SAMPLE_* strings when APIs return empty", () => {
  it("renders without SAMPLE_ACTIVITY strings", async () => {
    const { container } = render(wrap(Pipeline));
    await new Promise((r) => setTimeout(r, 50));

    const text = container.textContent ?? "";
    for (const sample of SAMPLE_ACTIVITY_STRINGS) {
      expect(text, `Pipeline should not show sample string "${sample}"`).not.toContain(sample);
    }
  });

  it("renders without SAMPLE_PROVIDER_MIX strings", async () => {
    const { container } = render(wrap(Pipeline));
    await new Promise((r) => setTimeout(r, 50));

    const text = container.textContent ?? "";
    for (const sample of SAMPLE_PROVIDER_MIX_STRINGS) {
      expect(text, `Pipeline should not show sample string "${sample}"`).not.toContain(sample);
    }
  });
});
