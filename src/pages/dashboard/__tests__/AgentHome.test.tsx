/**
 * AgentHome tests — TDD written before implementation.
 *
 * Covers:
 * A1. Renders live orders with StatusChips from mocked API data
 * A2. Renders the failure/needs_review state as "Needs attention" (first-class visual state)
 * A3. Renders EmptyState (no SAMPLE_* strings) when API returns empty
 * A4. Never renders SAMPLE_* strings
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "agent-001" },
    profile: { role: "user", first_name: "Alex" },
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

// ── Shared mock factories ─────────────────────────────────────────────────────
const activeOrder = {
  id: "prop-active-001",
  address: "45 Maple Street",
  status: "generating",
  created_at: new Date(Date.now() - 3600000).toISOString(),
  horizontal_video_url: null,
  vertical_video_url: null,
  thumbnail_url: null,
  price: 0,
  bedrooms: 3,
  bathrooms: 2,
  listing_agent: "Alex",
  brokerage: "Test Brokerage",
  photo_count: 10,
  selected_photo_count: 8,
  total_cost_cents: 0,
  processing_time_ms: 0,
};

const deliveredOrder = {
  id: "prop-delivered-001",
  address: "88 Ocean Drive",
  status: "complete",
  created_at: new Date(Date.now() - 86400000).toISOString(),
  horizontal_video_url: "https://cdn.example.com/vid.mp4",
  vertical_video_url: null,
  thumbnail_url: null,
  price: 0,
  bedrooms: 4,
  bathrooms: 3,
  listing_agent: "Alex",
  brokerage: "Test Brokerage",
  photo_count: 20,
  selected_photo_count: 15,
  total_cost_cents: 1500,
  processing_time_ms: 120000,
};

const failedOrder = {
  id: "prop-failed-001",
  address: "12 Broken Lane",
  status: "needs_review",
  created_at: new Date(Date.now() - 7200000).toISOString(),
  horizontal_video_url: null,
  vertical_video_url: null,
  thumbnail_url: null,
  price: 0,
  bedrooms: 2,
  bathrooms: 1,
  listing_agent: "Alex",
  brokerage: "Test Brokerage",
  photo_count: 5,
  selected_photo_count: 4,
  total_cost_cents: 0,
  processing_time_ms: 0,
};

// ── Mock API module ───────────────────────────────────────────────────────────
const mockFetchProperties = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchProperties: (...args: unknown[]) => mockFetchProperties(...args),
}));

// ── Import the component under test ──────────────────────────────────────────
import AgentHome from "../AgentHome";

function wrap() {
  return (
    <MemoryRouter>
      <AgentHome />
    </MemoryRouter>
  );
}

describe("AgentHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── A1: Active orders with StatusChips ─────────────────────────────────────
  it("renders the data-testid=agent-home root element", async () => {
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
    const { container } = render(wrap());
    // data-testid is present immediately (before data loads)
    expect(container.querySelector("[data-testid='agent-home']")).toBeTruthy();
  });

  it("renders 'In production' section with active order address and StatusChip", async () => {
    mockFetchProperties
      // first call: in-production (non-terminal statuses)
      .mockResolvedValueOnce({ properties: [activeOrder], total: 1 })
      // second call: delivered (complete status)
      .mockResolvedValueOnce({ properties: [], total: 0 })
      // third call: needs_review / failed
      .mockResolvedValueOnce({ properties: [], total: 0 });

    render(wrap());

    await waitFor(() => {
      expect(screen.queryByText("45 Maple Street")).toBeTruthy();
    });

    // StatusChip for "generating" → "Rendering"
    expect(screen.queryByText("Rendering")).toBeTruthy();
  });

  it("renders 'Delivered' section with delivered order address", async () => {
    mockFetchProperties
      .mockResolvedValueOnce({ properties: [], total: 0 })
      .mockResolvedValueOnce({ properties: [deliveredOrder], total: 1 })
      .mockResolvedValueOnce({ properties: [], total: 0 });

    render(wrap());

    await waitFor(() => {
      expect(screen.queryByText("88 Ocean Drive")).toBeTruthy();
    });
    // StatusChip for "complete" → "Delivered"
    expect(screen.queryAllByText("Delivered").length).toBeGreaterThan(0);
  });

  // ── A2: Failure / needs_review as first-class visual state ─────────────────
  it("renders needs_review/failed order as 'Needs attention' plainly visible", async () => {
    mockFetchProperties
      .mockResolvedValueOnce({ properties: [], total: 0 })
      .mockResolvedValueOnce({ properties: [], total: 0 })
      .mockResolvedValueOnce({ properties: [failedOrder], total: 1 });

    render(wrap());

    await waitFor(() => {
      expect(screen.queryByText("12 Broken Lane")).toBeTruthy();
    });
    // StatusChip for "needs_review" → "Needs attention" (may appear multiple times: chip + section title)
    expect(screen.queryAllByText("Needs attention").length).toBeGreaterThan(0);
    // The reassurance message must appear
    const container = screen.getByTestId("agent-home");
    expect(container.textContent).toContain("Needs attention");
  });

  it("shows the reassurance copy for needs_review orders (team notified)", async () => {
    mockFetchProperties
      .mockResolvedValueOnce({ properties: [], total: 0 })
      .mockResolvedValueOnce({ properties: [], total: 0 })
      .mockResolvedValueOnce({ properties: [failedOrder], total: 1 });

    const { container } = render(wrap());

    await waitFor(() => {
      expect(container.textContent.toLowerCase()).toContain("our team");
    });
  });

  // ── A3: EmptyState when all sections are empty ─────────────────────────────
  it("renders EmptyState (with data-empty-icon) when all API calls return empty", async () => {
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });

    const { container } = render(wrap());

    await waitFor(() => {
      expect(container.querySelector("[data-empty-icon]")).toBeTruthy();
    });
  });

  // ── A4: No SAMPLE_* strings ever ──────────────────────────────────────────
  it("does NOT render any SAMPLE_* strings when API returns live data", async () => {
    mockFetchProperties
      .mockResolvedValueOnce({ properties: [activeOrder], total: 1 })
      .mockResolvedValueOnce({ properties: [deliveredOrder], total: 1 })
      .mockResolvedValueOnce({ properties: [failedOrder], total: 1 });

    const { container } = render(wrap());
    await waitFor(() => {
      expect(screen.queryByText("45 Maple Street")).toBeTruthy();
    });
    expect(container.textContent).not.toContain("SAMPLE");
    expect(container.textContent).not.toContain("120 Greenwich");
    expect(container.textContent).not.toContain("9540 Vista Verde");
  });

  it("does NOT render any SAMPLE_* strings when API returns empty", async () => {
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });

    const { container } = render(wrap());
    await waitFor(() => {
      expect(container.querySelector("[data-empty-icon]")).toBeTruthy();
    });
    expect(container.textContent).not.toContain("SAMPLE");
    expect(container.textContent).not.toContain("120 Greenwich");
    expect(container.textContent).not.toContain("9540 Vista Verde");
  });

  // ── A5: Primary CTA — Order a video ───────────────────────────────────────
  it("renders the primary 'Order a video' CTA link", () => {
    mockFetchProperties.mockResolvedValue({ properties: [], total: 0 });
    render(wrap());
    // The CTA links to /upload
    const link = screen.getByRole("link", { name: /order a video/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/upload");
  });
});
