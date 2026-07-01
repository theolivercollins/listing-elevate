import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock ./db.js — getSupabase() returns a configurable fake client. The fake
// supports the two chained query shapes verifyAuth/the endpoint use:
//   - .from('user_profiles').select().eq().single()           (profile read)
//   - .from('impersonation_sessions').select().eq()...single() (session read)
//   - .from('impersonation_sessions').insert({...})            (start)
//   - .from('impersonation_sessions').update({...}).eq().is()  (stop)
// plus supabase.auth.getUser(token).
//
// Security-critical detail: the builder RECORDS every .eq()/.is()/.gt() call
// made on the session-lookup chain (the one that calls .select() on
// impersonation_sessions) into cfg.sessionFilters, in call order. This is
// what lets tests below assert the actual WHERE clause verifyAuth issues —
// token_hash, revoked_at IS NULL, expires_at > now, admin_user_id — instead
// of just trusting that whichever row was configured gets returned. Without
// this, a regression that deleted the admin_user_id filter (the line that
// stops admin B replaying admin A's token) would pass every existing test.
// The revoke/update chain (.update().eq().is(), used by 'stop') does NOT
// call .select() first, so it is never mistaken for the session-lookup chain.
// ---------------------------------------------------------------------------
vi.mock("./db.js", () => ({ getSupabase: vi.fn() }));

import { getSupabase } from "./db.js";
import { verifyAuth, requireAuth, requireAdmin, setNoStore } from "./auth.js";

interface FilterCall {
  op: "eq" | "is" | "gt";
  col: string;
  val: unknown;
}

interface MockConfig {
  user?: { id: string; email: string } | null;
  userError?: unknown;
  profile?: Record<string, unknown> | null;
  sessionRow?: Record<string, unknown> | null;
  dbError?: { message: string } | null;
  lastInsert?: { table: string; payload: unknown };
  lastUpdate?: { table: string; payload: unknown };
  /** Filters applied on the impersonation_sessions SELECT chain, in call order. */
  sessionFilters?: FilterCall[];
}

function createSupabaseMock(cfg: MockConfig) {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    // True only for the select()-first chain on impersonation_sessions (the
    // session-row lookup in verifyAuth) — never for the update()-first
    // revoke chain used by the 'stop' action, even though both target the
    // same table.
    let trackFilters = false;
    const recordFilter = (op: FilterCall["op"], col: string, val: unknown) => {
      if (trackFilters) cfg.sessionFilters!.push({ op, col, val });
    };
    Object.assign(b, {
      select: () => {
        if (table === "impersonation_sessions") {
          trackFilters = true;
          cfg.sessionFilters = [];
        }
        return b;
      },
      eq: (col: string, val: unknown) => {
        recordFilter("eq", col, val);
        return b;
      },
      is: (col: string, val: unknown) => {
        recordFilter("is", col, val);
        return b;
      },
      gt: (col: string, val: unknown) => {
        recordFilter("gt", col, val);
        return b;
      },
      insert: (payload: unknown) => {
        cfg.lastInsert = { table, payload };
        return b;
      },
      update: (payload: unknown) => {
        cfg.lastUpdate = { table, payload };
        return b;
      },
      single: () => {
        if (table === "user_profiles") {
          return Promise.resolve({ data: cfg.profile ?? null, error: null });
        }
        if (table === "impersonation_sessions") {
          return Promise.resolve({ data: cfg.sessionRow ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // thenable so awaited insert()/update().eq().is() resolve to { error }
      then: (resolve: (v: { error: unknown }) => unknown) =>
        Promise.resolve({ error: cfg.dbError ?? null }).then(resolve),
    });
    return b;
  };
  return {
    from: (t: string) => builder(t),
    auth: {
      getUser: async () => ({
        data: { user: cfg.user ?? null },
        error: cfg.userError ?? null,
      }),
    },
  };
}

function useMock(cfg: MockConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
    createSupabaseMock(cfg) as any
  );
  return cfg;
}

interface FakeRes {
  headers: Record<string, string>;
  statusCode: number | null;
  body: unknown;
  setHeader: (k: string, v: string) => void;
  status: (c: number) => FakeRes;
  json: (b: unknown) => FakeRes;
}
function makeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    statusCode: null,
    body: undefined,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const ADMIN = { id: "admin-1", email: "admin@x.com" };
const adminProfile = { id: "p1", user_id: "admin-1", role: "admin", email: "admin@x.com" };
const userProfile = { id: "p2", user_id: "user-2", role: "user", email: "user@x.com" };

function reqWith(headers: Record<string, string>) {
  return { headers, body: {} } as unknown as Parameters<typeof verifyAuth>[0];
}

const BEARER = { authorization: "Bearer jwt" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("verifyAuth — impersonation honoring", () => {
  it("honors a valid token for a real admin (effective role overridden)", async () => {
    const cfg = useMock({
      user: ADMIN,
      profile: adminProfile,
      sessionRow: {
        id: "sess-1",
        impersonated_role: "user",
        admin_user_id: "admin-1",
        revoked_at: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const before = Date.now();
    const auth = await verifyAuth(reqWith({ ...BEARER, "x-impersonate-token": "tok" }));
    expect(auth).not.toBeNull();
    expect(auth!.profile.role).toBe("user"); // EFFECTIVE
    expect(auth!.impersonating).toEqual({ realRole: "admin", as: "user", sessionId: "sess-1" });

    // Prove the session-row query actually applied every security-critical
    // filter — token_hash, revoked_at IS NULL, expires_at > now, and
    // (most importantly) admin_user_id = the real JWT identity. The mock's
    // .eq()/.is()/.gt() used to be no-op stubs, so this assertion is the
    // only thing that would catch a regression deleting any one of these.
    expect(cfg.sessionFilters).toEqual([
      { op: "eq", col: "token_hash", val: createHash("sha256").update("tok").digest("hex") },
      { op: "is", col: "revoked_at", val: null },
      { op: "gt", col: "expires_at", val: expect.any(String) },
      { op: "eq", col: "admin_user_id", val: "admin-1" },
    ]);
    const gtFilter = cfg.sessionFilters!.find((f) => f.op === "gt" && f.col === "expires_at")!;
    const gtTimestamp = new Date(gtFilter.val as string).getTime();
    expect(gtTimestamp).toBeGreaterThanOrEqual(before);
    expect(gtTimestamp).toBeLessThanOrEqual(Date.now());
  });

  it("applies the admin_user_id filter as the real JWT identity, not a value an attacker controls (blocks admin B replaying admin A's token)", async () => {
    // Admin B (id "admin-2") presents a token header; even if some
    // sessionRow happened to exist, the query MUST be scoped by admin B's
    // own JWT-derived id, never by anything from the request body/headers.
    const adminB = { id: "admin-2", email: "adminb@x.com" };
    const adminBProfile = { id: "p3", user_id: "admin-2", role: "admin", email: "adminb@x.com" };
    const cfg = useMock({
      user: adminB,
      profile: adminBProfile,
      sessionRow: null, // admin A's session row would not match admin B's id — DB returns nothing
    });
    const auth = await verifyAuth(reqWith({ ...BEARER, "x-impersonate-token": "admin-a-token" }));
    expect(auth!.profile.role).toBe("admin"); // not escalated/switched — real profile only
    expect(auth!.impersonating).toBeUndefined();

    const adminFilter = cfg.sessionFilters!.find((f) => f.col === "admin_user_id");
    expect(adminFilter).toEqual({ op: "eq", col: "admin_user_id", val: "admin-2" });
    expect(adminFilter!.val).not.toBe("admin-1");
  });

  it("ignores a token (even a valid admin-owned one) when real profile is NOT admin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useMock({
      user: { id: "user-2", email: "user@x.com" },
      profile: userProfile,
      // sessionRow would resolve, but we must never even consult it for a non-admin
      sessionRow: { id: "sess-x", impersonated_role: "admin", admin_user_id: "user-2", revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    const auth = await verifyAuth(reqWith({ ...BEARER, "x-impersonate-token": "tok" }));
    expect(auth!.profile.role).toBe("user"); // NEVER escalated
    expect(auth!.impersonating).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores an expired/revoked/mismatched token (session row absent) and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useMock({ user: ADMIN, profile: adminProfile, sessionRow: null });
    const auth = await verifyAuth(reqWith({ ...BEARER, "x-impersonate-token": "tok" }));
    expect(auth!.profile.role).toBe("admin"); // real profile, unchanged
    expect(auth!.impersonating).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("ignores the token entirely when opts.ignoreImpersonation is true", async () => {
    useMock({
      user: ADMIN,
      profile: adminProfile,
      sessionRow: { id: "sess-1", impersonated_role: "user", admin_user_id: "admin-1", revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    const auth = await verifyAuth(
      reqWith({ ...BEARER, "x-impersonate-token": "tok" }),
      { ignoreImpersonation: true }
    );
    expect(auth!.profile.role).toBe("admin");
    expect(auth!.impersonating).toBeUndefined();
  });

  it("returns null without a Bearer token", async () => {
    useMock({ user: ADMIN, profile: adminProfile });
    expect(await verifyAuth(reqWith({}))).toBeNull();
  });
});

describe("requireAuth / requireAdmin — cache headers + gating", () => {
  it("requireAuth sets no-store + Vary on the response", async () => {
    useMock({ user: ADMIN, profile: adminProfile });
    const res = makeRes();
    await requireAuth(reqWith(BEARER), res as never);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.headers["Vary"]).toBe("Authorization, x-impersonate-token");
  });

  it("requireAdmin 403s an admin who is impersonating a user", async () => {
    useMock({
      user: ADMIN,
      profile: adminProfile,
      sessionRow: { id: "sess-1", impersonated_role: "user", admin_user_id: "admin-1", revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    const res = makeRes();
    const auth = await requireAdmin(
      reqWith({ ...BEARER, "x-impersonate-token": "tok" }),
      res as never
    );
    expect(auth).toBeNull();
    expect(res.statusCode).toBe(403);
    // headers still set even on the 403 path
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("requireAdmin succeeds for an admin not impersonating", async () => {
    useMock({ user: ADMIN, profile: adminProfile });
    const res = makeRes();
    const auth = await requireAdmin(reqWith(BEARER), res as never);
    expect(auth).not.toBeNull();
    expect(auth!.profile.role).toBe("admin");
  });
});

describe("setNoStore", () => {
  it("sets both headers", () => {
    const res = makeRes();
    setNoStore(res as never);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.headers["Vary"]).toBe("Authorization, x-impersonate-token");
  });
});

describe("impersonation endpoint — start/stop with ignoreImpersonation", () => {
  it("start inserts a hashed-token session and returns the raw token once", async () => {
    const cfg = useMock({ user: ADMIN, profile: adminProfile });
    const { default: handler } = await import("../api/admin/impersonation.js");
    const req = { headers: { ...BEARER }, method: "POST", body: { action: "start", role: "user" } } as never;
    const res = makeRes();
    await handler(req, res as never);
    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; role: string; expiresAt: string };
    expect(body.role).toBe("user");
    expect(body.token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex
    expect(typeof body.expiresAt).toBe("string");
    // raw token is NOT what we store — we store its sha256
    const inserted = cfg.lastInsert!.payload as { token_hash: string; admin_user_id: string; impersonated_role: string };
    expect(inserted.token_hash).not.toBe(body.token);
    expect(inserted.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.admin_user_id).toBe("admin-1");
    expect(inserted.impersonated_role).toBe("user");
  });

  it("start rejects an invalid role with 400", async () => {
    useMock({ user: ADMIN, profile: adminProfile });
    const { default: handler } = await import("../api/admin/impersonation.js");
    const req = { headers: { ...BEARER }, method: "POST", body: { action: "start", role: "superuser" } } as never;
    const res = makeRes();
    await handler(req, res as never);
    expect(res.statusCode).toBe(400);
  });

  it("stop revokes the caller's active sessions (works while impersonating)", async () => {
    const cfg = useMock({
      user: ADMIN,
      profile: adminProfile,
      // an active session exists; the endpoint must ignore it for auth and still revoke
      sessionRow: { id: "sess-1", impersonated_role: "user", admin_user_id: "admin-1", revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    const { default: handler } = await import("../api/admin/impersonation.js");
    const req = { headers: { ...BEARER, "x-impersonate-token": "tok" }, method: "POST", body: { action: "stop" } } as never;
    const res = makeRes();
    await handler(req, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((cfg.lastUpdate!.payload as { revoked_at: string }).revoked_at).toBeDefined();
  });

  it("rejects a non-admin caller with 403", async () => {
    useMock({ user: { id: "user-2", email: "user@x.com" }, profile: userProfile });
    const { default: handler } = await import("../api/admin/impersonation.js");
    const req = { headers: { ...BEARER }, method: "POST", body: { action: "start", role: "user" } } as never;
    const res = makeRes();
    await handler(req, res as never);
    expect(res.statusCode).toBe(403);
  });
});
