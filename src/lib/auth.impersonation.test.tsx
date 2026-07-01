import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Supabase client: a signed-in admin, no MFA, profile read returns role 'admin'.
vi.mock("./supabase", () => {
  const adminProfile = {
    id: "p1",
    user_id: "admin-1",
    role: "admin",
    email: "admin@x.com",
    colors: { primary: "#000", secondary: "#fff" },
    presets: [],
  };
  return {
    AUTH_CALLBACK_URL: "http://localhost/auth/callback",
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "admin-1", email: "admin@x.com" } } },
        }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", email: "admin@x.com" } },
        }),
        mfa: {
          listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }),
          getAuthenticatorAssuranceLevel: vi
            .fn()
            .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }),
        },
      },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: adminProfile }) }),
        }),
      })),
    },
  };
});
vi.mock("./presets", () => ({ migrateLocalPresets: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./api", () => ({ authedFetch: vi.fn() }));

import { AuthProvider, useAuth, IMPERSONATABLE_ROLES } from "./auth";
import { authedFetch } from "./api";

type Ctx = ReturnType<typeof useAuth>;
let ctx: Ctx;
function Capture() {
  ctx = useAuth();
  return null;
}

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function renderAndLoad() {
  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(ctx.realRole).toBe("admin"));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(authedFetch).mockReset();
});
afterEach(() => {
  sessionStorage.clear();
});

describe("IMPERSONATABLE_ROLES", () => {
  it("exposes Admin + Agent options in order", () => {
    expect(IMPERSONATABLE_ROLES).toEqual([
      { value: "admin", label: "Admin" },
      { value: "user", label: "Agent" },
    ]);
  });
});

describe("auth context — impersonation", () => {
  it("effective profile === real profile when not impersonating", async () => {
    await renderAndLoad();
    expect(ctx.profile?.role).toBe("admin");
    expect(ctx.realProfile?.role).toBe("admin");
    expect(ctx.isImpersonating).toBe(false);
  });

  it("start: awaits POST, overrides effective role, stores token", async () => {
    await renderAndLoad();
    vi.mocked(authedFetch).mockResolvedValue(
      okJson({ token: "raw-tok", role: "user", expiresAt: new Date().toISOString() })
    );
    await act(async () => {
      await ctx.setImpersonatedRole("user");
    });
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/admin/impersonation",
      expect.objectContaining({ method: "POST" })
    );
    expect(ctx.profile?.role).toBe("user"); // EFFECTIVE
    expect(ctx.realProfile?.role).toBe("admin"); // REAL unchanged
    expect(ctx.isImpersonating).toBe(true);
    expect(sessionStorage.getItem("le_impersonate_role")).toBe("user");
    expect(sessionStorage.getItem("le_impersonate_token")).toBe("raw-tok");
  });

  it("start failure throws and does NOT switch", async () => {
    await renderAndLoad();
    vi.mocked(authedFetch).mockResolvedValue(new Response("nope", { status: 500 }));
    await act(async () => {
      await expect(ctx.setImpersonatedRole("user")).rejects.toThrow();
    });
    expect(ctx.profile?.role).toBe("admin");
    expect(ctx.isImpersonating).toBe(false);
    expect(sessionStorage.getItem("le_impersonate_token")).toBeNull();
  });

  it("stop clears state + sessionStorage even if the server call is best-effort", async () => {
    await renderAndLoad();
    vi.mocked(authedFetch).mockResolvedValue(
      okJson({ token: "raw-tok", role: "user", expiresAt: new Date().toISOString() })
    );
    await act(async () => {
      await ctx.setImpersonatedRole("user");
    });
    expect(ctx.isImpersonating).toBe(true);

    vi.mocked(authedFetch).mockResolvedValue(okJson({ ok: true }));
    await act(async () => {
      await ctx.setImpersonatedRole(null);
    });
    expect(ctx.isImpersonating).toBe(false);
    expect(ctx.profile?.role).toBe("admin");
    expect(sessionStorage.getItem("le_impersonate_token")).toBeNull();
    expect(sessionStorage.getItem("le_impersonate_role")).toBeNull();
  });

  it("stop still clears locally when the server call rejects", async () => {
    await renderAndLoad();
    vi.mocked(authedFetch).mockResolvedValue(
      okJson({ token: "raw-tok", role: "user", expiresAt: new Date().toISOString() })
    );
    await act(async () => {
      await ctx.setImpersonatedRole("user");
    });
    vi.mocked(authedFetch).mockRejectedValue(new Error("network"));
    await act(async () => {
      await ctx.setImpersonatedRole(null);
    });
    expect(ctx.isImpersonating).toBe(false);
    expect(sessionStorage.getItem("le_impersonate_token")).toBeNull();
  });

  it("signOut clears impersonation", async () => {
    await renderAndLoad();
    vi.mocked(authedFetch).mockResolvedValue(
      okJson({ token: "raw-tok", role: "user", expiresAt: new Date().toISOString() })
    );
    await act(async () => {
      await ctx.setImpersonatedRole("user");
    });
    expect(ctx.isImpersonating).toBe(true);
    await act(async () => {
      await ctx.signOut();
    });
    expect(sessionStorage.getItem("le_impersonate_token")).toBeNull();
    expect(sessionStorage.getItem("le_impersonate_role")).toBeNull();
  });

  it("rehydrates impersonation from sessionStorage on mount", async () => {
    sessionStorage.setItem("le_impersonate_role", "user");
    sessionStorage.setItem("le_impersonate_token", "raw-tok");
    await renderAndLoad();
    expect(ctx.isImpersonating).toBe(true);
    expect(ctx.profile?.role).toBe("user");
    expect(ctx.realProfile?.role).toBe("admin");
  });

  it("ignores a half-present sessionStorage pair (token missing)", async () => {
    sessionStorage.setItem("le_impersonate_role", "user");
    await renderAndLoad();
    expect(ctx.isImpersonating).toBe(false);
    expect(ctx.profile?.role).toBe("admin");
  });
});
