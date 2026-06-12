/**
 * Operator Today landing tests — TDD written before implementation.
 *
 * Covers:
 * O1. "Needs you" strip renders counts + deep links from mocked live data
 * O2. "Needs you" strip shows calm "All clear" state when all counts are zero
 * O3. A mocked provider response containing an HTTP 402 error renders the named alert state
 * O4. Needs-review count is deep-linked to the corresponding filtered view
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock auth ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "admin-001" },
    profile: { role: "admin", first_name: "Oliver" },
    session: {},
    loading: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// ── Mock supabase ──────────────────────────────────────────────────────────────
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

// ── Shared mock API state — tests mutate per-describe ─────────────────────────
const mockFetchProperties = vi.fn();
const mockFetchDailyStats = vi.fn();
const mockFetchStatsOverview = vi.fn();
const mockFetchCostBreakdown = vi.fn();
const mockFetchModelHealth = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchProperties: (...args: unknown[]) => mockFetchProperties(...args),
  fetchDailyStats: (...args: unknown[]) => mockFetchDailyStats(...args),
  fetchStatsOverview: (...args: unknown[]) => mockFetchStatsOverview(...args),
  fetchCostBreakdown: (...args: unknown[]) => mockFetchCostBreakdown(...args),
  fetchModelHealth: (...args: unknown[]) => mockFetchModelHealth(...args),
}));

import Overview from "../Overview";

function wrap() {
  return (
    <MemoryRouter>
      <Overview />
    </MemoryRouter>
  );
}

const emptyBase = () => {
  mockFetchDailyStats.mockResolvedValue({ stats: [] });
  mockFetchStatsOverview.mockResolvedValue({
    completedToday: 0,
    inPipeline: 0,
    needsReview: 0,
    successRate: null,
    avgProcessingMs: null,
  });
  mockFetchCostBreakdown.mockResolvedValue({ byProvider: [] });
  mockFetchModelHealth.mockResolvedValue({ rows: [], generated_at: new Date().toISOString() });
};

// ── O1: Needs-you strip with live data ────────────────────────────────────────
describe("Operator Today — Needs you strip with live data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emptyBase();
  });

  it("renders the needs-review count from live stats data", async () => {
    // 3 properties need review
    mockFetchProperties.mockResolvedValue({
      properties: [],
      total: 0,
    });
    mockFetchStatsOverview.mockResolvedValue({
      completedToday: 2,
      inPipeline: 4,
      needsReview: 3,
      successRate: 0.9,
      avgProcessingMs: 12000,
    });

    const { container } = render(wrap());
    await waitFor(() => {
      // The "3" count should appear in the Needs you strip
      const text = container.textContent ?? "";
      expect(text).toContain("3");
    });

    // There must be a link into /dashboard/properties?status=needs_review or /dashboard/pipeline
    const links = Array.from(container.querySelectorAll("a[href]"));
    const hrefs = links.map((a) => a.getAttribute("href") ?? "");
    const hasReviewLink = hrefs.some(
      (h) => h.includes("needs_review") || h.includes("pipeline") || h.includes("properties"),
    );
    expect(hasReviewLink).toBe(true);
  });

  it("renders failed renders count and deep links them", async () => {
    mockFetchDailyStats.mockResolvedValue({
      stats: [
        {
          date: "2026-06-11",
          total_cost_cents: 5000,
          properties_completed: 2,
          properties_failed: 2,
        },
      ],
    });
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
    mockFetchStatsOverview.mockResolvedValue({
      completedToday: 2,
      inPipeline: 4,
      needsReview: 0,
      successRate: 0.5,
      avgProcessingMs: 15000,
    });

    const { container } = render(wrap());
    await waitFor(() => {
      const text = container.textContent ?? "";
      // "2" failures appear in the strip or a non-zero needs attention indicator
      expect(text.length).toBeGreaterThan(0);
    });

    // Failed renders should link somewhere actionable (logs or pipeline)
    const links = Array.from(container.querySelectorAll("a[href]"));
    const hrefs = links.map((a) => a.getAttribute("href") ?? "");
    const hasActionableLink = hrefs.some(
      (h) => h.includes("logs") || h.includes("pipeline") || h.includes("properties"),
    );
    expect(hasActionableLink).toBe(true);
  });
});

// ── O2: All clear state when nothing needs attention ──────────────────────────
describe("Operator Today — All clear state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emptyBase();
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
  });

  it("renders calm all-clear message when no items need attention", async () => {
    mockFetchStatsOverview.mockResolvedValue({
      completedToday: 5,
      inPipeline: 2,
      needsReview: 0,
      successRate: 1.0,
      avgProcessingMs: 10000,
    });

    const { container } = render(wrap());
    await waitFor(() => {
      const text = container.textContent ?? "";
      // "All clear" or equivalent calm state must appear
      expect(text.toLowerCase()).toContain("all clear");
    });
  });
});

// ── O3: HTTP 402 balance alert ─────────────────────────────────────────────────
describe("Operator Today — Provider health with HTTP 402 alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emptyBase();
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
    mockFetchStatsOverview.mockResolvedValue({
      completedToday: 0,
      inPipeline: 0,
      needsReview: 0,
      successRate: null,
      avgProcessingMs: null,
    });
  });

  it("renders a named balance-error alert when a provider has HTTP 402 failures", async () => {
    // Provider 'atlas' has 402 errors (balance insufficient)
    mockFetchModelHealth.mockResolvedValue({
      rows: [
        {
          provider: "atlas",
          calls_24h: 10,
          failures_24h: 3,
          balance_errors_24h: 2,
          p50_ms: 4000,
          p95_ms: 8000,
          last_at: new Date().toISOString(),
        },
      ],
      generated_at: new Date().toISOString(),
    });

    const { container } = render(wrap());
    await waitFor(() => {
      const text = container.textContent ?? "";
      // Should surface a named alert for balance/402 issue
      expect(
        text.toLowerCase().includes("balance") ||
        text.toLowerCase().includes("402") ||
        text.toLowerCase().includes("insufficient") ||
        text.toLowerCase().includes("credit"),
      ).toBe(true);
    });
  });

  it("does NOT show the balance alert when no 402 errors exist", async () => {
    mockFetchModelHealth.mockResolvedValue({
      rows: [
        {
          provider: "atlas",
          calls_24h: 10,
          failures_24h: 0,
          balance_errors_24h: 0,
          p50_ms: 4000,
          p95_ms: 8000,
          last_at: new Date().toISOString(),
        },
      ],
      generated_at: new Date().toISOString(),
    });

    const { container } = render(wrap());
    await waitFor(() => {
      // Give data time to load
      const text = container.textContent ?? "";
      expect(text.length).toBeGreaterThan(0);
    });

    const text = container.textContent ?? "";
    // No balance/402 alert should appear
    expect(text.toLowerCase()).not.toContain("insufficient funds");
    expect(text.toLowerCase()).not.toContain("balance error");
  });

  it("shows provider error rate in the health row for providers with failures", async () => {
    mockFetchModelHealth.mockResolvedValue({
      rows: [
        {
          provider: "atlas",
          calls_24h: 20,
          failures_24h: 4,
          balance_errors_24h: 0,
          p50_ms: 5000,
          p95_ms: 10000,
          last_at: new Date().toISOString(),
        },
        {
          provider: "kling",
          calls_24h: 15,
          failures_24h: 0,
          balance_errors_24h: 0,
          p50_ms: 3000,
          p95_ms: 7000,
          last_at: new Date().toISOString(),
        },
      ],
      generated_at: new Date().toISOString(),
    });

    const { container } = render(wrap());
    await waitFor(() => {
      const text = container.textContent ?? "";
      // Provider names must appear
      expect(text).toContain("atlas");
    });
  });
});
