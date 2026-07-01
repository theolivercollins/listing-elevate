import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase client so authedFetch attaches a stable Bearer token.
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "jwt-abc" } } }),
    },
  },
}));

import { authedFetch, getImpersonationToken } from "./api";

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 })
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function lastHeaders(): Record<string, string> {
  const call = fetchMock.mock.calls.at(-1)!;
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe("api impersonation header", () => {
  it("getImpersonationToken reads the sessionStorage key", () => {
    expect(getImpersonationToken()).toBeNull();
    sessionStorage.setItem("le_impersonate_token", "tok-123");
    expect(getImpersonationToken()).toBe("tok-123");
  });

  it("attaches x-impersonate-token on a normal authed request when a token is present", async () => {
    sessionStorage.setItem("le_impersonate_token", "tok-123");
    await authedFetch("/api/properties");
    const h = lastHeaders();
    expect(h["Authorization"]).toBe("Bearer jwt-abc");
    expect(h["x-impersonate-token"]).toBe("tok-123");
  });

  it("does NOT attach the token to the impersonation control endpoint", async () => {
    sessionStorage.setItem("le_impersonate_token", "tok-123");
    await authedFetch("/api/admin/impersonation", { method: "POST" });
    const h = lastHeaders();
    expect(h["Authorization"]).toBe("Bearer jwt-abc");
    expect(h["x-impersonate-token"]).toBeUndefined();
  });

  it("attaches no impersonation header when no token is stored", async () => {
    await authedFetch("/api/properties");
    expect(lastHeaders()["x-impersonate-token"]).toBeUndefined();
  });
});
