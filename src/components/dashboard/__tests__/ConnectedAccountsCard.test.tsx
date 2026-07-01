/**
 * ConnectedAccountsCard — Wave 2 of the login revamp.
 *
 * Deliberately a standalone component (not inlined in Profile.tsx) so it can
 * be rendered with RTL: Profile.tsx imports the real `@/lib/supabase`
 * singleton client directly, which OOMs happy-dom when mounted in tests (see
 * the note atop ../../../pages/dashboard/__tests__/Profile.test.tsx). This
 * card only depends on `useAuth()` (mocked below) + sonner, so the real
 * supabase-js client never enters the module graph.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserIdentity } from "@supabase/supabase-js";
import * as authLib from "@/lib/auth";
import { ConnectedAccountsCard } from "../ConnectedAccountsCard";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
import { toast } from "sonner";

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

function makeIdentity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    identity_id: overrides.identity_id ?? "id-" + Math.random().toString(36).slice(2),
    id: overrides.id ?? "sub-id",
    user_id: "user-1",
    provider: "email",
    identity_data: {},
    created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as UserIdentity;
}

function mockAuth(overrides: Partial<ReturnType<typeof authLib.useAuth>> = {}) {
  const base = {
    listIdentities: vi.fn(() => Promise.resolve([])),
    linkIdentity: vi.fn(() => Promise.resolve()),
    unlinkIdentity: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  (authLib.useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);
  return base;
}

describe("ConnectedAccountsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one row per identity returned by listIdentities", async () => {
    const identities = [
      makeIdentity({ identity_id: "i-email", provider: "email", identity_data: { email: "a@b.com" } }),
      makeIdentity({ identity_id: "i-google", provider: "google", identity_data: { email: "a@gmail.com" } }),
    ];
    mockAuth({ listIdentities: vi.fn(() => Promise.resolve(identities)) });

    render(<ConnectedAccountsCard />);

    await waitFor(() => expect(screen.getByText("Email")).toBeInTheDocument());
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText("a@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
  });

  it('"Connect Google" calls linkIdentity("google")', async () => {
    const identities = [makeIdentity({ identity_id: "i-email", provider: "email" })];
    const auth = mockAuth({ listIdentities: vi.fn(() => Promise.resolve(identities)) });

    render(<ConnectedAccountsCard />);

    const btn = await screen.findByRole("button", { name: "Connect Google" });
    fireEvent.click(btn);

    await waitFor(() => expect(auth.linkIdentity).toHaveBeenCalledWith("google"));
  });

  it("Disconnect on a google identity calls unlinkIdentity", async () => {
    const identities = [
      makeIdentity({ identity_id: "i-email", provider: "email" }),
      makeIdentity({ identity_id: "i-google", provider: "google" }),
    ];
    const auth = mockAuth({ listIdentities: vi.fn(() => Promise.resolve(identities)) });

    render(<ConnectedAccountsCard />);

    const btn = await screen.findByRole("button", { name: "Disconnect" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() =>
      expect(auth.unlinkIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ identity_id: "i-google" })
      )
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Disconnected"));
  });

  it("with only ONE identity, all Disconnect buttons are disabled (last-identity guard)", async () => {
    // A single, non-email identity: the ONLY case where a Disconnect button
    // renders at all with just one identity — and it must be disabled.
    const identities = [makeIdentity({ identity_id: "i-google", provider: "google" })];
    mockAuth({ listIdentities: vi.fn(() => Promise.resolve(identities)) });

    render(<ConnectedAccountsCard />);

    const btn = await screen.findByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "You can't remove your only sign-in method.");
  });

  it("a linkIdentity rejection shows a toast, no crash", async () => {
    const identities = [makeIdentity({ identity_id: "i-email", provider: "email" })];
    const auth = mockAuth({
      listIdentities: vi.fn(() => Promise.resolve(identities)),
      linkIdentity: vi.fn(() => Promise.reject(new Error("provider not enabled"))),
    });

    render(<ConnectedAccountsCard />);

    const btn = await screen.findByRole("button", { name: "Connect Google" });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't start linking — this provider may not be enabled yet"
      )
    );
    expect(auth.linkIdentity).toHaveBeenCalledWith("google");
    // Still rendered, no crash.
    expect(screen.getByText("Connected accounts")).toBeInTheDocument();
  });

  it("shows a loading state while listIdentities resolves", () => {
    let resolveFn: (v: UserIdentity[]) => void = () => {};
    mockAuth({
      listIdentities: vi.fn(
        () => new Promise<UserIdentity[]>((resolve) => { resolveFn = resolve; })
      ),
    });

    render(<ConnectedAccountsCard />);
    expect(screen.getByText(/Loading connected accounts/i)).toBeInTheDocument();
    resolveFn([]);
  });

  it("shows an error state instead of crashing when listIdentities rejects", async () => {
    mockAuth({ listIdentities: vi.fn(() => Promise.reject(new Error("network down"))) });

    render(<ConnectedAccountsCard />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load connected accounts/i)).toBeInTheDocument()
    );
  });
});
