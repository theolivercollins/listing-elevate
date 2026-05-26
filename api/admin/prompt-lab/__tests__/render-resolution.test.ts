/**
 * render-resolution.test.ts — Lane A: per-model quality dropdown (v1.1)
 *
 * Verifies that POST /api/admin/prompt-lab/render:
 *
 *   1. POST with resolution='720p' → submitLabRender receives resolution='720p'
 *      AND the iteration UPDATE carries resolution_used='720p'.
 *   2. POST without resolution → submitLabRender receives resolution=null/undefined;
 *      resolutionUsed falls back to descriptor default (null or '1080p').
 *   3. POST with invalid resolution='8k' → 400 before submitLabRender is called.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── submitLabRender mock ──────────────────────────────────────────────────────
const mockSubmitLabRender = vi.fn();
vi.mock("../../../../lib/prompt-lab", () => ({
  submitLabRender: (...args: unknown[]) => mockSubmitLabRender(...args),
  ProviderCapacityError: class ProviderCapacityError extends Error {
    provider: string; inFlight: number; limit: number;
    constructor(p: string, i: number, l: number) {
      super(`${p} at capacity`); this.provider = p; this.inFlight = i; this.limit = l;
    }
  },
}));

// ── end-frame resolver mock ───────────────────────────────────────────────────
vi.mock("../../../../lib/services/end-frame", () => ({
  resolveEndFrameUrl: vi.fn().mockResolvedValue(null),
}));

// ── Atlas SKU mock — v1.1 catalog including seedance ─────────────────────────
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

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetSupabase = vi.fn();
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => mockGetSupabase(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// Base v1.1 iteration row (no clip, no task yet).
const BASE_ITERATION = {
  id: "iter-res-1",
  session_id: "sess-res-1",
  iteration_number: 1,
  director_output_json: {
    prompt: "Smooth push-in over the kitchen island",
    camera_movement: "push_in",
    duration_seconds: 5,
    scene_number: 1,
    photo_id: "photo-r1",
    room_type: "kitchen",
    provider_preference: null,
  },
  analysis_json: { room_type: "kitchen" },
  clip_url: null,
  provider_task_id: null,
  end_photo_id: null,
  end_image_url: null,
  prompt_lab_sessions: {
    image_url: "https://example.com/kitchen.jpg",
    pipeline_version: "v1.1",
  },
};

/**
 * Build a chainable Supabase mock that captures all UPDATE payloads.
 */
function buildSupabaseMock(updates: Record<string, unknown>[]) {
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: BASE_ITERATION, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { ...BASE_ITERATION, ...payload }, error: null }),
              }),
            }),
          };
        },
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: {}, error: null }),
          }),
        }),
      };
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockSubmitLabRender.mockReset();
  mockGetSupabase.mockReset();
  vi.resetModules();

  // Re-declare mocks after resetModules so each test gets fresh module state.
  vi.mock("../../../../lib/auth", () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock("../../../../lib/prompt-lab", () => ({
    submitLabRender: (...args: unknown[]) => mockSubmitLabRender(...args),
    ProviderCapacityError: class ProviderCapacityError extends Error {
      provider: string; inFlight: number; limit: number;
      constructor(p: string, i: number, l: number) {
        super(`${p} at capacity`); this.provider = p; this.inFlight = i; this.limit = l;
      }
    },
  }));
  vi.mock("../../../../lib/services/end-frame", () => ({
    resolveEndFrameUrl: vi.fn().mockResolvedValue(null),
  }));
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
  vi.mock("../../../../lib/client", () => ({
    getSupabase: () => mockGetSupabase(),
  }));
});

describe("render.ts — resolution threading (Lane A)", () => {
  // ── Test 1: explicit resolution='720p' ──────────────────────────────────────
  it("POST with resolution='720p' → submitLabRender receives 720p AND iteration UPDATE carries resolution_used='720p'", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    // submitLabRender returns resolutionUsed='720p' (what the caller passed in).
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-720",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
      resolutionUsed: "720p",
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({
      body: {
        iteration_id: "iter-res-1",
        sku: "seedance-pro-pushin",
        resolution: "720p",
      },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // 1. submitLabRender was called with resolution='720p'.
    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.resolution).toBe("720p");

    // 2. The iteration UPDATE carries resolution_used='720p'.
    const iterUpdate = updates.find((u) => u.model_used != null || u.resolution_used != null);
    expect(iterUpdate?.resolution_used).toBe("720p");

    // 3. Response is OK (not 4xx).
    expect(res._status).not.toBe(400);
    expect(res._status).not.toBe(500);
  });

  // ── Test 2: no resolution supplied → descriptor default ────────────────────
  it("POST without resolution → submitLabRender receives no resolution param AND iteration UPDATE carries resolutionUsed from submitLabRender return", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    // When no resolution override is sent, submitLabRender uses the descriptor
    // default. The Seedance descriptor defaults to '1080p', so resolutionUsed='1080p'.
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-default-res",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
      resolutionUsed: "1080p",
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({
      body: {
        iteration_id: "iter-res-1",
        sku: "seedance-pro-pushin",
        // No resolution field.
      },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // 1. submitLabRender was called (no resolution key or null/undefined is OK).
    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    // resolution should be null (we pass `resolution: null` when not provided)
    // OR simply absent — either is correct. Assert it is not '720p' or '480p'.
    expect(callArgs.resolution).not.toBe("720p");
    expect(callArgs.resolution).not.toBe("480p");

    // 2. The iteration UPDATE carries the resolution_used returned by submitLabRender ('1080p').
    const iterUpdate = updates.find((u) => u.model_used != null || u.resolution_used != null);
    expect(iterUpdate?.resolution_used).toBe("1080p");

    // 3. Response is OK.
    expect(res._status).not.toBe(400);
    expect(res._status).not.toBe(500);
  });

  // ── Test 3: invalid resolution → 400 ───────────────────────────────────────
  it("POST with invalid resolution='8k' → 400 before submitLabRender is called", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({
      body: {
        iteration_id: "iter-res-1",
        sku: "seedance-pro-pushin",
        resolution: "8k",
      },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // Handler must reject with 400 before reaching submitLabRender.
    expect(res._status).toBe(400);
    expect(mockSubmitLabRender).not.toHaveBeenCalled();

    // Error message must mention the invalid value.
    const body = res._body as { error?: string };
    expect(body.error).toMatch(/8k/);
  });
});
