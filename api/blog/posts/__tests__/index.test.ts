// Tests for GET /api/blog/posts — search sanitization (F25 fix).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => mockGetSupabase(),
}));

import handler, { sanitizePostgrestLike } from "../index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    _status: 0,
    _body: {} as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

function makeReq(query: Record<string, string> = {}): VercelRequest {
  return {
    method: "GET",
    query,
    body: {},
    headers: {},
  } as unknown as VercelRequest;
}

const adminUser = {
  user: { id: "u1", email: "admin@test.com" },
  profile: { role: "admin" },
};

/**
 * Build a chainable Supabase query-builder mock that records the `.or()` call
 * (if any) and resolves immediately with `result`.
 */
function makeSupabase(result: { data: unknown[]; error: null | { message: string } }) {
  let capturedOrArg: string | undefined;

  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  const methods = ["select", "eq", "order", "limit", "in", "lt"] as const;

  // Terminal — resolves the query
  const terminal = () => Promise.resolve(result);

  // Every builder method returns the same chain object; `or` additionally
  // captures its argument so tests can assert on it.
  const chainProxy = new Proxy(chain, {
    get(_t, prop: string) {
      if (prop === "or") {
        return (arg: string) => {
          capturedOrArg = arg;
          return chainProxy;
        };
      }
      if (prop === "then") {
        // Make the chain itself thenable so `await qb` works.
        return terminal().then.bind(terminal());
      }
      return (..._args: unknown[]) => chainProxy;
    },
  });

  const supabase = {
    from(_table: string) {
      return chainProxy;
    },
    _getCapturedOrArg() {
      return capturedOrArg;
    },
  };

  return supabase;
}

// ---------------------------------------------------------------------------
// Unit tests: sanitizePostgrestLike
// ---------------------------------------------------------------------------

describe("sanitizePostgrestLike", () => {
  it("passes through a normal search term unchanged", () => {
    expect(sanitizePostgrestLike("downtown condo")).toBe("downtown condo");
  });

  it("strips commas", () => {
    expect(sanitizePostgrestLike("foo,bar")).toBe("foobar");
  });

  it("strips open and close parentheses", () => {
    expect(sanitizePostgrestLike("foo(bar)baz")).toBe("foobarbaz");
  });

  it("strips backslash", () => {
    expect(sanitizePostgrestLike("foo\\bar")).toBe("foobar");
  });

  it("strips a compound injection payload: comma + parens", () => {
    expect(sanitizePostgrestLike("foo,bar)")).toBe("foobar");
  });

  it("strips a dotted field-injection attempt (dots are preserved — not grammar at this position)", () => {
    // Dots are not stripped; they are safe inside a %value% literal.
    expect(sanitizePostgrestLike("a.b")).toBe("a.b");
  });

  it("returns empty string when input is entirely metacharacters", () => {
    expect(sanitizePostgrestLike(",()\\")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: handler sanitizes q before building the .or() filter
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetSupabase.mockReset();
});

describe("GET /api/blog/posts — search sanitization (F25)", () => {
  it("builds the .or() filter with wildcards added by code, not user input", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const sb = makeSupabase({ data: [], error: null });
    mockGetSupabase.mockReturnValue(sb);

    const res = makeRes();
    await handler(makeReq({ q: "downtown" }), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(sb._getCapturedOrArg()).toBe("title.ilike.%downtown%,meta_title.ilike.%downtown%");
  });

  it("strips PostgREST metacharacters from q before building .or() — comma+paren payload", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const sb = makeSupabase({ data: [], error: null });
    mockGetSupabase.mockReturnValue(sb);

    const res = makeRes();
    // Injection attempt: "foo,bar)" would split the .or() into 3 conditions without sanitization.
    await handler(makeReq({ q: "foo,bar)" }), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const orArg = sb._getCapturedOrArg();
    expect(orArg).not.toContain(",bar)");
    // Sanitized to "foobar", then wrapped in wildcards by code.
    expect(orArg).toBe("title.ilike.%foobar%,meta_title.ilike.%foobar%");
  });

  it("strips PostgREST metacharacters — dotted field injection attempt", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const sb = makeSupabase({ data: [], error: null });
    mockGetSupabase.mockReturnValue(sb);

    const res = makeRes();
    await handler(makeReq({ q: "a.b" }), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    // Dots are safe in value position; "a.b" passes through intact.
    expect(sb._getCapturedOrArg()).toBe("title.ilike.%a.b%,meta_title.ilike.%a.b%");
  });

  it("omits .or() entirely when q sanitizes to empty string", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const sb = makeSupabase({ data: [], error: null });
    mockGetSupabase.mockReturnValue(sb);

    const res = makeRes();
    // q is entirely metacharacters — nothing safe remains, so no .or() should be issued.
    await handler(makeReq({ q: ",()\\" }), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(sb._getCapturedOrArg()).toBeUndefined();
  });

  it("normal search (no q) never calls .or()", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const sb = makeSupabase({ data: [], error: null });
    mockGetSupabase.mockReturnValue(sb);

    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(sb._getCapturedOrArg()).toBeUndefined();
  });
});
