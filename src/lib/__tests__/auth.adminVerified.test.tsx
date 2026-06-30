/**
 * Provider-level admin-verification marker tests.
 *
 * These cover the security-critical invariants of the AdminEmailVerifyWall gate
 * that live in the AuthProvider itself (not the wall UI):
 *
 * 1. A session whose JWT amr proves email possession (method `otp`) is marked
 *    admin-verified → for an admin profile, adminVerified is true (no wall).
 * 2. A password session (amr method `password`) is NEVER marked → for an admin
 *    profile, adminVerified is false (wall would show). Fail-closed.
 * 3. The typed-code path (verifyAdminEmailCode) sets the marker.
 * 4. signOut clears the marker for that user id.
 *
 * The real AuthProvider is exercised; only `@/lib/supabase` (auth + db) and the
 * preset migration side-effect are mocked, so the amr-decode + markAdminVerified
 * logic under test is the actual production code path.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth";
import { supabase } from "@/lib/supabase";

// ── Hoisted, mutable mock state (shared with the vi.mock factory) ────────────
const h = vi.hoisted(() => ({
  state: {
    session: null as null | { access_token: string; user: { id: string; email?: string } },
    profile: { user_id: "admin-1", role: "admin" } as { user_id: string; role: string } | null,
  },
}));

vi.mock("@/lib/supabase", () => ({
  AUTH_CALLBACK_URL: "http://localhost/auth/callback",
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: h.state.session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: h.state.session?.user ?? null } }),
      ),
      signInWithOtp: vi.fn(() => Promise.resolve({ error: null })),
      verifyOtp: vi.fn(() =>
        Promise.resolve({ data: { user: { id: "admin-1" } }, error: null }),
      ),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: h.state.profile })),
        })),
      })),
    })),
  },
}));

// Avoid the localStorage→DB preset migration side-effect on SIGNED_IN.
vi.mock("@/lib/presets", () => ({
  migrateLocalPresets: vi.fn(() => Promise.resolve()),
}));

// ── JWT helpers (build a fake Supabase access token with a chosen amr claim) ──
function b64url(json: string): string {
  // UTF-8 safe base64url, inverse of decodeJwtPayload in auth.tsx.
  const bin = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hx) =>
    String.fromCharCode(parseInt(hx, 16)),
  );
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeToken(amr: Array<{ method: string; timestamp: number }>): string {
  return "x." + b64url(JSON.stringify({ amr })) + ".y";
}
function makeSession(amr: Array<{ method: string; timestamp: number }>) {
  return {
    access_token: makeToken(amr),
    user: { id: "admin-1", email: "admin@example.com" },
  };
}

const MARKER_KEY = "le_admin_verified:admin-1";

// ── Probe: surfaces the provider's adminVerified + actions for assertions ────
function Probe() {
  const { adminVerified, profile, verifyAdminEmailCode, signOut } = useAuth();
  return (
    <div>
      <span data-testid="admin-verified">{String(adminVerified)}</span>
      <span data-testid="role">{profile?.role ?? "none"}</span>
      <button data-testid="verify" onClick={() => void verifyAdminEmailCode("123456").catch(() => {})}>
        verify
      </button>
      <button data-testid="signout" onClick={() => void signOut()}>
        signout
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  h.state.session = null;
  h.state.profile = { user_id: "admin-1", role: "admin" };
});

describe("AuthProvider admin-verified marker", () => {
  it("1. a session with amr method 'otp' is marked verified → admin gets adminVerified=true", async () => {
    h.state.session = makeSession([{ method: "otp", timestamp: 1 }]);

    renderProvider();

    // Wait for the profile to load (proves getSession + fetchProfile settled).
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("admin"));

    // Marker set by the amr-mark path (what isAdminVerified reads).
    expect(sessionStorage.getItem(MARKER_KEY)).toBe("1");
    // Render-derived gate is open for the admin.
    expect(screen.getByTestId("admin-verified").textContent).toBe("true");
  });

  it("2. a password session (amr method 'password') is NOT marked → admin gets adminVerified=false", async () => {
    h.state.session = makeSession([{ method: "password", timestamp: 1 }]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("admin"));

    expect(sessionStorage.getItem(MARKER_KEY)).toBeNull();
    expect(screen.getByTestId("admin-verified").textContent).toBe("false");
  });

  it("3. verifyAdminEmailCode success sets the marker → adminVerified flips true", async () => {
    // Start from a password session so the gate is closed before the typed code.
    h.state.session = makeSession([{ method: "password", timestamp: 1 }]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("admin-verified").textContent).toBe("false"));
    expect(sessionStorage.getItem(MARKER_KEY)).toBeNull();

    fireEvent.click(screen.getByTestId("verify"));

    await waitFor(() => expect(sessionStorage.getItem(MARKER_KEY)).toBe("1"));
    expect(screen.getByTestId("admin-verified").textContent).toBe("true");
  });

  it("4. signOut clears the marker for that user id", async () => {
    h.state.session = makeSession([{ method: "otp", timestamp: 1 }]);

    renderProvider();

    await waitFor(() => expect(sessionStorage.getItem(MARKER_KEY)).toBe("1"));

    fireEvent.click(screen.getByTestId("signout"));

    await waitFor(() => expect(sessionStorage.getItem(MARKER_KEY)).toBeNull());
  });

  it("5. a SIGNED_OUT (null session) from onAuthStateChange clears the admin-verified marker", async () => {
    // Start verified: an email-possession session marks the user admin-verified.
    h.state.session = makeSession([{ method: "otp", timestamp: 1 }]);

    renderProvider();

    await waitFor(() => expect(sessionStorage.getItem(MARKER_KEY)).toBe("1"));
    expect(screen.getByTestId("admin-verified").textContent).toBe("true");

    // Fire onAuthStateChange with a null session — models a SIGNED_OUT from token
    // expiry / revocation / another-tab broadcast (NOT the signOut() button). The
    // provider's else-branch must drop the stale marker so a later same-tab
    // password login cannot skip the wall.
    const onAuthCb = (supabase.auth.onAuthStateChange as any).mock.calls[0][0];
    act(() => {
      onAuthCb("SIGNED_OUT", null);
    });

    await waitFor(() => expect(sessionStorage.getItem(MARKER_KEY)).toBeNull());
  });
});
