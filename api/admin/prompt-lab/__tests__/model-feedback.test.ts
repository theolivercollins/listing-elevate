/**
 * model-feedback.test.ts
 *
 * Tests for POST + GET /api/admin/prompt-lab/model-feedback.
 *
 * 1. POST creates row with correct denormalized fields from parent iteration.
 * 2. POST 400 when comment is empty.
 * 3. POST 400 when iteration_id doesn't exist.
 * 4. GET ?iteration_id returns rows for that iteration only (filter test).
 * 5. GET ?model=X&pipeline_version=v1.1 returns recent rows scoped to model + version.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Embeddings mock — fire-and-forget; we don't await it in the handler ──────
vi.mock("../../../../lib/embeddings", () => ({
  embedTextSafe: vi.fn().mockResolvedValue(null),
  toPgVector: (v: number[]) => `[${v.join(",")}]`,
}));

// ── Supabase chainable mock ───────────────────────────────────────────────────
type ChainResult = { data: unknown; error: unknown };

function makeIterationChain(result: ChainResult) {
  // Mirrors the chaining pattern: .from().select().eq().maybeSingle()
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.single = () => Promise.resolve(result);
  return chain;
}

// The Supabase client is stateful — we need per-test control of what each
// chained call returns. We expose `mockChainResult` so individual tests can
// inject the return value.
let mockChainFn = vi.fn();
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => ({
    from: (...args: unknown[]) => mockChainFn(...args),
  }),
}));

// ── Handler import (after mocks are set up) ───────────────────────────────────
const { default: handler } = await import("../model-feedback.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(
  method: string,
  body?: unknown,
  query?: Record<string, string>
): VercelRequest {
  return {
    method,
    body: body ?? {},
    query: query ?? {},
    headers: { authorization: "Bearer test-token" },
  } as unknown as VercelRequest;
}

function makeRes() {
  const calls: Array<{ status: number; body: unknown }> = [];
  let currentStatus = 200;
  const res = {
    status(s: number) { currentStatus = s; return res; },
    json(b: unknown) { calls.push({ status: currentStatus, body: b }); return res; },
    setHeader: vi.fn(),
    _calls: calls,
    _last() { return calls[calls.length - 1]; },
  };
  return res as unknown as VercelResponse & { _calls: typeof calls; _last(): typeof calls[0] };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: auth passes
  mockRequireAdmin.mockResolvedValue({ user: { id: "user-abc", email: "admin@test.com" }, profile: { role: "admin" } });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: POST creates row with correct denormalized fields
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/admin/prompt-lab/model-feedback", () => {
  it("creates row with correct denormalized fields from parent iteration", async () => {
    const fakeIteration = {
      id: "iter-1",
      session_id: "sess-1",
      model_used: "kling-v2-master",
      pipeline_version: "v1.1",
      resolution_used: "1080p",
      prompt_lab_sessions: { pipeline_version: "v1.1" },
    };
    const fakeInsertedRow = {
      id: "feedback-1",
      iteration_id: "iter-1",
      session_id: "sess-1",
      model_used: "kling-v2-master",
      pipeline_version: "v1.1",
      resolution_used: "1080p",
      author: "user-abc",
      comment: "great motion smoothness",
      created_at: "2026-05-26T00:00:00Z",
    };

    // Mock chain: first call (maybeSingle for iteration) returns the iteration,
    // second chain (insert...single) returns the inserted row.
    let callCount = 0;
    mockChainFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // iteration lookup
        return makeIterationChain({ data: fakeIteration, error: null });
      }
      // insert chain
      const insertChain: Record<string, unknown> = {};
      insertChain.insert = () => insertChain;
      insertChain.select = () => insertChain;
      insertChain.single = () => Promise.resolve({ data: fakeInsertedRow, error: null });
      insertChain.update = () => insertChain;
      insertChain.eq = () => insertChain;
      return insertChain;
    });

    const req = makeReq("POST", { iteration_id: "iter-1", comment: "great motion smoothness" });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(201);
    const body = last.body as Record<string, unknown>;
    expect(body.model_used).toBe("kling-v2-master");
    expect(body.pipeline_version).toBe("v1.1");
    expect(body.session_id).toBe("sess-1");
    expect(body.comment).toBe("great motion smoothness");
    expect(body.author).toBe("user-abc");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: POST 400 when comment is empty
  // ─────────────────────────────────────────────────────────────────────────
  it("returns 400 when comment is empty string", async () => {
    const req = makeReq("POST", { iteration_id: "iter-1", comment: "   " });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(400);
    expect((last.body as { error: string }).error).toMatch(/comment/i);
  });

  it("returns 400 when comment is missing", async () => {
    const req = makeReq("POST", { iteration_id: "iter-1" });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(400);
    expect((last.body as { error: string }).error).toMatch(/comment/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: POST 400 when iteration_id doesn't exist
  // ─────────────────────────────────────────────────────────────────────────
  it("returns 400 when iteration_id does not exist", async () => {
    mockChainFn.mockImplementation(() =>
      makeIterationChain({ data: null, error: { message: "not found" } })
    );

    const req = makeReq("POST", { iteration_id: "nonexistent", comment: "test comment" });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(400);
    expect((last.body as { error: string }).error).toMatch(/iteration not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: GET ?iteration_id returns rows for that iteration only
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/prompt-lab/model-feedback", () => {
  it("?iteration_id returns rows for that iteration only", async () => {
    const rows = [
      { id: "fb-1", iteration_id: "iter-1", session_id: "sess-1", model_used: "kling-v2-master", pipeline_version: "v1.1", resolution_used: null, author: "user-abc", comment: "A", created_at: "2026-05-24T00:00:00Z" },
      { id: "fb-2", iteration_id: "iter-1", session_id: "sess-1", model_used: "kling-v2-master", pipeline_version: "v1.1", resolution_used: null, author: "user-abc", comment: "B", created_at: "2026-05-25T00:00:00Z" },
    ];

    mockChainFn.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.from = () => chain;
      // Return the promise of result when the terminal method is called.
      // The handler calls .eq().eq().order() — we resolve at order step.
      // Simplest: override order to return the promise directly.
      chain.order = () => Promise.resolve({ data: rows, error: null });
      return chain;
    });

    const req = makeReq("GET", undefined, { iteration_id: "iter-1" });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(200);
    const body = last.body as Array<{ iteration_id: string }>;
    expect(body).toHaveLength(2);
    expect(body.every((r) => r.iteration_id === "iter-1")).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: GET ?model=X&pipeline_version=v1.1 returns recent rows scoped to
  //         model + version
  // ─────────────────────────────────────────────────────────────────────────
  it("?model=X&pipeline_version=v1.1 returns rows scoped to model + version", async () => {
    const rows = [
      { id: "fb-3", iteration_id: "iter-2", session_id: "sess-2", model_used: "kling-v2-master", pipeline_version: "v1.1", resolution_used: null, author: "user-abc", comment: "C", created_at: "2026-05-26T00:00:00Z" },
    ];

    mockChainFn.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.from = () => chain;
      chain.order = () => chain;
      chain.limit = () => Promise.resolve({ data: rows, error: null });
      return chain;
    });

    const req = makeReq("GET", undefined, { model: "kling-v2-master", pipeline_version: "v1.1", limit: "20" });
    const res = makeRes();
    await handler(req, res as VercelResponse);

    const last = (res as ReturnType<typeof makeRes>)._last();
    expect(last.status).toBe(200);
    const body = last.body as Array<{ model_used: string; pipeline_version: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.model_used === "kling-v2-master")).toBe(true);
    expect(body.every((r) => r.pipeline_version === "v1.1")).toBe(true);
  });
});
