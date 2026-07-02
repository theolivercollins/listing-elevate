/**
 * AdminEmailVerifyWall tests.
 *
 * Covers:
 * 1. RequireAdmin with admin + adminVerified:false renders wall and calls sendAdminEmailCode once
 * 2. Typing a valid 6-digit code + clicking Verify calls verifyAdminEmailCode with that code
 * 3. Rejected verifyAdminEmailCode surfaces a role="alert" error message
 * 4. Resend button is disabled during cooldown right after mount
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AdminEmailVerifyWall } from "../AdminEmailVerifyWall";
import { RequireAdmin } from "../ProtectedRoute";

// ── Mutable auth mock ─────────────────────────────────────────────────────────
const mockAuth = {
  user: { id: "admin-1", email: "admin@example.com" } as { id: string; email?: string } | null,
  profile: { role: "admin" as "admin" | "user", first_name: "Test" } as
    | { role: "admin" | "user"; first_name: string }
    | null,
  session: {} as object | null,
  loading: false,
  adminVerified: false,
  sendAdminEmailCode: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  verifyAdminEmailCode: vi.fn<(code: string) => Promise<void>>().mockResolvedValue(undefined),
  signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  refreshProfile: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  signInWithMagicLink: vi.fn<(email: string) => Promise<void>>().mockResolvedValue(undefined),
  signInWithPassword: vi.fn<(email: string, password: string) => Promise<void>>().mockResolvedValue(undefined),
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: "admin-1", email: "admin@example.com" };
  mockAuth.profile = { role: "admin", first_name: "Test" };
  mockAuth.loading = false;
  mockAuth.adminVerified = false;
  mockAuth.sendAdminEmailCode = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  mockAuth.verifyAdminEmailCode = vi.fn<(code: string) => Promise<void>>().mockResolvedValue(undefined);
  mockAuth.signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  mockAuth.refreshProfile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
});

// ── Render helpers ────────────────────────────────────────────────────────────
function renderWall() {
  return render(
    <MemoryRouter>
      <AdminEmailVerifyWall />
    </MemoryRouter>,
  );
}

function renderViaRequireAdmin() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AdminEmailVerifyWall", () => {
  it("1. RequireAdmin with admin + adminVerified:false renders the wall and calls sendAdminEmailCode exactly once", async () => {
    renderViaRequireAdmin();

    await waitFor(() => {
      expect(screen.getByText("Verify it's you")).toBeInTheDocument();
    });

    // Auto-send fires once on mount (StrictMode guard prevents second call)
    expect(mockAuth.sendAdminEmailCode).toHaveBeenCalledTimes(1);
  });

  it("2. typing a valid 6-digit code and clicking Verify calls verifyAdminEmailCode with that code", async () => {
    renderWall();

    // The input is always present from the initial render
    const input = await screen.findByLabelText("6-digit code");
    fireEvent.change(input, { target: { value: "123456" } });

    // Submit button becomes enabled once 6 digits are entered
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(mockAuth.verifyAdminEmailCode).toHaveBeenCalledWith("123456");
    });
  });

  it("3. when verifyAdminEmailCode rejects, a role=alert error is shown", async () => {
    mockAuth.verifyAdminEmailCode = vi
      .fn<(code: string) => Promise<void>>()
      .mockRejectedValue(new Error("Token is expired or invalid"));

    renderWall();

    const input = await screen.findByLabelText("6-digit code");
    fireEvent.change(input, { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByRole("alert").textContent).toMatch(/incorrect or expired/i);
  });

  it("4. Resend button is disabled during the cooldown period right after mount", () => {
    renderWall();

    // cooldown initialises to 60 so the button is disabled from the very first render
    const resendBtn = screen.getByRole("button", { name: /resend/i });
    expect(resendBtn).toBeDisabled();
  });

  it("5. when adminVerified is true, RequireAdmin renders children (wall is gone)", () => {
    mockAuth.adminVerified = true;
    renderViaRequireAdmin();
    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Verify it's you")).not.toBeInTheDocument();
  });
});
