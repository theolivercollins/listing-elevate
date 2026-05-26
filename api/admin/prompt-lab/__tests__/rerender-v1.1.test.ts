/**
 * rerender-v1.1.test.ts
 *
 * Verifies that POST /api/admin/prompt-lab/rerender applies v1.1 overrides
 * when the parent session has pipeline_version='v1.1':
 *
 *   1. submitLabRender is called with pipelineVersion='v1.1' and
 *      providerOverride=null (user-supplied provider is ignored).
 *   2. The newly-inserted iteration row carries pipeline_version='v1.1'.
 *   3. The UPDATE carries model_used='seedance-pro-pushin' and
 *      pipeline_version='v1.1'.
 *
 * v1 sessions must be unaffected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── prompt-lab mock ────────────────────────────────────────────────────────────
const mockSubmitLabRender = vi.fn();
const mockGetNextIterationNumber = vi.fn().mockResolvedValue(2);
vi.mock("../../../../lib/prompt-lab", () => ({
  submitLabRender: (...args: unknown[]) => mockSubmitLabRender(...args),
  getNextIterationNumber: (...args: unknown[]) => mockGetNextIterationNumber(...args),
  ANALYSIS_PROMPT_HASH: "aabbccdd",
  DIRECTOR_PROMPT_HASH: "11223344",
  ProviderCapacityError: class ProviderCapacityError extends Error {
    provider: string; inFlight: number; limit: number;
    constructor(p: string, i: number, l: number) {
      super(`${p} at capacity`); this.provider = p; this.inFlight = i; this.limit = l;
    }
  },
}));

// ── Atlas SKU mock ─────────────────────────────────────────────────────────────
vi.mock("../../../../lib/providers/atlas", () => ({
  V1_ATLAS_SKUS: ["kling-v2-6-pro", "kling-v2-master"],
  V1_1_LAB_SKUS: [
    "seedance-pro-pushin",
    "kling-v3-pro",
    "kling-v2-6-pro",
    "kling-v2-master",
    "runway-gen4-native",
  ],
}));

// ── Supabase mock ──────────────────────────────────────────────────────────────
const mockGetSupabase = vi.fn();
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => mockGetSupabase(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────
const adminUser = { user: { id: "u1", email: "admin@test.com" }, profile: { role: "admin" } };

function makeRes() {
  const r = { _status: 0, _body: {} as unknown };
  return Object.assign(r, {
    status(code: number) { r._status = code; return this; },
    json(body: unknown) { r._body = body; return this; },
    setHeader() { return this; },
  });
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return { method: "POST", query: {}, body: {}, headers: {}, ...overrides } as unknown as VercelRequest;
}

// Base source iteration row (already rendered, has director output).
const SOURCE_ITERATION = {
  id: "src-iter-1",
  session_id: "sess-1",
  iteration_number: 1,
  model_used: "kling-v2-6-pro",
  director_output_json: {
    prompt: "Smooth orbit around the fireplace",
    camera_movement: "orbit",
    duration_seconds: 5,
    scene_number: 1,
    photo_id: "photo-1",
    room_type: "living_room",
    provider_preference: null,
  },
  analysis_json: { room_type: "living_room" },
  analysis_prompt_hash: "aabbccdd",
  director_prompt_hash: "11223344",
  embedding: null,
  embedding_model: null,
  retrieval_metadata: null,
  clip_url: "https://cdn.example.com/clip.mp4",
};

// New iteration row returned after INSERT
const NEW_ITERATION = {
  id: "new-iter-1",
  session_id: "sess-1",
  iteration_number: 2,
};

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockSubmitLabRender.mockReset();
  mockGetNextIterationNumber.mockReset().mockResolvedValue(2);
  mockGetSupabase.mockReset();
});

/**
 * Build a supabase mock that:
 * - Returns SOURCE_ITERATION + the given session data on the first .from("prompt_lab_iterations") query
 * - Returns NEW_ITERATION on INSERT
 * - Captures all UPDATE payloads into `updates`
 */
function buildSupabaseMock(
  sessionPipelineVersion: string | undefined,
  updates: Record<string, unknown>[]
) {
  const sourceWithSession = {
    ...SOURCE_ITERATION,
    prompt_lab_sessions: {
      image_url: "https://example.com/img.jpg",
      ...(sessionPipelineVersion !== undefined ? { pipeline_version: sessionPipelineVersion } : {}),
    },
  };

  let insertCalled = false;

  return {
    from(_table: string) {
      return {
        select: (_fields?: string) => ({
          eq: (_col: string, _val: unknown) => ({
            single: () => Promise.resolve({ data: sourceWithSession, error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          insertCalled = true;
          updates.push({ _op: "insert", ...payload });
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { ...NEW_ITERATION, ...payload }, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          updates.push({ _op: "update", ...payload });
          return {
            eq: (_col: string, _val: unknown) => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: { ...NEW_ITERATION, ...payload },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    },
  };
}

describe("rerender.ts — v1.1 pipeline_version override", () => {
  it("calls submitLabRender with pipelineVersion='v1.1', providerOverride=null when session is v1.1 and no valid v1.1 sku supplied", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-v11",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock("v1.1", updates));

    const { default: handler } = await import("../rerender.js");
    const req = makeReq({
      body: {
        source_iteration_id: "src-iter-1",
        provider: "kling",   // user-supplied provider — ignored for Seedance (Atlas-only)
        // No sku supplied → v1.1 defaults to seedance-pro-pushin.
        // (Passing a valid V1_1 sku like kling-v2-6-pro would forward it as-is —
        // that case is covered by render-v1.1-multi-model.test.ts.)
      },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // submitLabRender called once with correct args
    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");
    // No sku supplied → defaults to seedance-pro-pushin
    expect(callArgs.sku).toBe("seedance-pro-pushin");
    // Seedance is Atlas-only → providerOverride must be null
    expect(callArgs.providerOverride).toBeNull();

    // INSERT carries pipeline_version='v1.1'
    const insertRow = updates.find((u) => u._op === "insert");
    expect(insertRow?.pipeline_version).toBe("v1.1");

    // UPDATE carries model_used='seedance-pro-pushin' and pipeline_version='v1.1'
    const updateRow = updates.find((u) => u._op === "update" && u.model_used);
    expect(updateRow?.model_used).toBe("seedance-pro-pushin");
    expect(updateRow?.pipeline_version).toBe("v1.1");
  });

  it("respects user-supplied provider/sku for v1 sessions (existing behavior)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-v1",
      provider: "atlas",
      sku: "kling-v2-master",
      staticSku: "kling-v2-master",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock("v1", updates));

    const { default: handler } = await import("../rerender.js");
    const req = makeReq({
      body: {
        source_iteration_id: "src-iter-1",
        provider: "kling",
        sku: "kling-v2-master",
      },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1");
    // v1: providerOverride is the user-supplied value
    expect(callArgs.providerOverride).toBe("kling");
    // v1: sku is the user-supplied value
    expect(callArgs.sku).toBe("kling-v2-master");

    // INSERT carries pipeline_version='v1'
    const insertRow = updates.find((u) => u._op === "insert");
    expect(insertRow?.pipeline_version).toBe("v1");

    // UPDATE carries pipeline_version='v1'
    const updateRow = updates.find((u) => u._op === "update" && u.model_used);
    expect(updateRow?.pipeline_version).toBe("v1");
  });

  it("defaults to v1 when session has no pipeline_version (pre-migration)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-pre",
      provider: "atlas",
      sku: "kling-v2-6-pro",
      staticSku: "kling-v2-6-pro",
    });

    const updates: Record<string, unknown>[] = [];
    // No pipeline_version on session (simulate pre-migration-067)
    mockGetSupabase.mockReturnValue(buildSupabaseMock(undefined, updates));

    const { default: handler } = await import("../rerender.js");
    const req = makeReq({
      body: { source_iteration_id: "src-iter-1", provider: "runway" },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1");
  });
});
