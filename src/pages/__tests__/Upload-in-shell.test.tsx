/**
 * Upload-in-shell tests — TDD written before the re-shell implementation (WS6).
 *
 * Goal of WS6: the /upload wizard must live inside the L2 dashboard app-shell
 * (DashboardSidebar + le-dash-shell chrome) instead of its own standalone
 * marketing glass.css full-page treatment (glass-page + SiteNav + glass-bg-base).
 *
 * These tests pin the CHROME swap only — they must NOT assert anything about the
 * payment/checkout path, file upload mechanics, MLS lookup, voiceover preview,
 * or step ordering/validity (the live revenue path stays byte-identical).
 *
 * Asserted:
 *   1. The dashboard shell marker (.le-dash-shell) is present.
 *   2. The marketing SiteNav and the standalone .glass-page wrapper are GONE.
 *   3. Step 0 (Style) controls still render: package, duration, orientation choices.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// happy-dom doesn't ship a localStorage in this config; the dashboard sidebar's
// collapsed-state hook reads/writes it. Provide a minimal in-memory stub.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  });
});

// ── Mock auth (logged-in user) ────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "agent-001" },
    profile: { role: "user", first_name: "Alex" },
    session: {},
    loading: false,
    adminVerified: true,
    sendAdminEmailCode: vi.fn(),
    verifyAdminEmailCode: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

// ── Mock supabase (sidebar + auth helpers touch it) ───────────────────────────
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

// ── Mock the revenue-path + data APIs (no network, no Stripe) ─────────────────
vi.mock("@/lib/api", () => ({
  createProperty: vi.fn(),
  generateVoiceoverPreview: vi.fn(),
  lookupMls: vi.fn(),
}));

// ── Mock presets (called on mount via useEffect) ──────────────────────────────
vi.mock("@/lib/presets", () => ({
  getPresets: vi.fn().mockResolvedValue([]),
  savePreset: vi.fn(),
}));

// ── Mock the login dialog context (Upload pulls openLogin out of it) ──────────
vi.mock("@/v2/components/auth/LoginDialogContext", () => ({
  useLoginDialog: () => ({ openLogin: vi.fn() }),
}));

// ── Address autocomplete is network-y; stub to a plain input ──────────────────
vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: (props: { value?: string }) => (
    <input data-testid="address-autocomplete" defaultValue={props.value} />
  ),
}));

import Upload from "../Upload";

function wrap() {
  return (
    <MemoryRouter>
      <Upload />
    </MemoryRouter>
  );
}

describe("Upload — re-shelled into the L2 dashboard app-shell", () => {
  it("renders inside the dashboard shell (.le-dash-shell present)", () => {
    const { container } = render(wrap());
    expect(container.querySelector(".le-dash-shell")).toBeTruthy();
  });

  it("no longer renders the marketing standalone glass-page wrapper", () => {
    const { container } = render(wrap());
    expect(container.querySelector(".glass-page")).toBeNull();
    expect(container.querySelector(".glass-bg-base")).toBeNull();
  });

  it("still renders the step-0 (Style) selectors — revenue path intact", () => {
    render(wrap());
    // Package choices
    expect(screen.getByText("Just Listed")).toBeTruthy();
    expect(screen.getByText("Life Cycle")).toBeTruthy();
    // Duration tiles (15 / 30 / 60 seconds)
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
    // Orientation
    expect(screen.getByText("Horizontal")).toBeTruthy();
  });
});
