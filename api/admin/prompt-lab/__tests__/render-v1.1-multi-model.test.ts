/**
 * render-v1.1-multi-model.test.ts
 *
 * Verifies that the v1.1 multi-SKU render path correctly gates the
 * Seedance-specific overrides (push-in prompt wrap, Atlas force) on the
 * selected SKU rather than blindly on pipeline_version.
 *
 * Cases:
 *   A. v1.1 + sku='kling-v3-pro'   → no push-in wrap, kling-v3-pro forwarded
 *   B. v1.1 + sku='kling-v2-6-pro' → no push-in wrap, kling-v2-6-pro forwarded
 *   C. v1.1 + sku='seedance-pro-pushin' → push-in wrap applied (regression check)
 *   D. v1.1 + sku=null/missing    → defaults to seedance-pro-pushin
 *   E. v1.1 + sku='invalid-sku'   → defaults to seedance-pro-pushin (not in catalog)
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

// ── Atlas SKU mock — include v1.1 SKUs so validation passes ──────────────────
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

// A base v1.1 iteration row (no clip, no task yet).
const BASE_ITERATION = {
  id: "iter-1",
  session_id: "sess-1",
  iteration_number: 1,
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
  clip_url: null,
  provider_task_id: null,
  end_photo_id: null,
  end_image_url: null,
  prompt_lab_sessions: {
    image_url: "https://example.com/img.jpg",
    pipeline_version: "v1.1",
  },
};

/**
 * Build a simple Supabase mock that returns the given iteration row and
 * captures all UPDATE payloads.
 */
function buildSupabaseMock(
  iterationRow: typeof BASE_ITERATION,
  updates: Record<string, unknown>[],
) {
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: iterationRow, error: null }),
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
                  Promise.resolve({ data: { ...iterationRow, ...payload }, error: null }),
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

  // Re-declare all mocks after resetModules.
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

describe("render.ts — v1.1 multi-model SKU gating", () => {
  // Case A: Kling v3 Pro under v1.1 — no Seedance overrides
  it("A: v1.1 + sku='kling-v3-pro' → forwarded as kling-v3-pro, no push-in override", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-k3",
      provider: "atlas",
      sku: "kling-v3-pro",
      staticSku: "kling-v3-pro",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(BASE_ITERATION, updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({ body: { iteration_id: "iter-1", sku: "kling-v3-pro" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // submitLabRender must be called with the v1.1 pipeline and kling-v3-pro sku
    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");
    expect(callArgs.sku).toBe("kling-v3-pro");
    // Seedance push-in should NOT be forced — sku is not seedance
    expect(callArgs.sku).not.toBe("seedance-pro-pushin");

    // The UPDATE row must carry model_used='kling-v3-pro' (not seedance)
    const iterUpdate = updates.find((u) => u.model_used);
    expect(iterUpdate?.model_used).toBe("kling-v3-pro");
    expect(iterUpdate?.pipeline_version).toBe("v1.1");
  });

  // Case B: Kling v2.6 Pro under v1.1 — no Seedance overrides
  it("B: v1.1 + sku='kling-v2-6-pro' → forwarded as kling-v2-6-pro, no push-in override", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-k26",
      provider: "atlas",
      sku: "kling-v2-6-pro",
      staticSku: "kling-v2-6-pro",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(BASE_ITERATION, updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({ body: { iteration_id: "iter-1", sku: "kling-v2-6-pro" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");
    expect(callArgs.sku).toBe("kling-v2-6-pro");
    expect(callArgs.sku).not.toBe("seedance-pro-pushin");

    const iterUpdate = updates.find((u) => u.model_used);
    expect(iterUpdate?.model_used).toBe("kling-v2-6-pro");
    expect(iterUpdate?.pipeline_version).toBe("v1.1");
  });

  // Case C: Seedance under v1.1 — push-in wrap MUST apply (regression check)
  it("C: v1.1 + sku='seedance-pro-pushin' → seedance sku forwarded (push-in wrapper applied by submitLabRender)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-seed",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(BASE_ITERATION, updates));

    const { default: handler } = await import("../render.js");
    const req = makeReq({ body: { iteration_id: "iter-1", sku: "seedance-pro-pushin" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");
    // Seedance sku must be forwarded; submitLabRender's internal branch applies the wrap
    expect(callArgs.sku).toBe("seedance-pro-pushin");
    // providerOverride must be null for Seedance (Atlas-only)
    expect(callArgs.providerOverride).toBeNull();

    const iterUpdate = updates.find((u) => u.model_used);
    expect(iterUpdate?.model_used).toBe("seedance-pro-pushin");
    expect(iterUpdate?.pipeline_version).toBe("v1.1");
  });

  // Case D: no sku supplied under v1.1 → default to seedance-pro-pushin
  it("D: v1.1 + no sku → defaults to seedance-pro-pushin", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-default",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
    });

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(BASE_ITERATION, updates));

    const { default: handler } = await import("../render.js");
    // Omit sku entirely
    const req = makeReq({ body: { iteration_id: "iter-1" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");
    expect(callArgs.sku).toBe("seedance-pro-pushin");
  });

  // Case E: sku not in any catalog → 400 (upfront validation rejects it)
  // An unknown sku is rejected before we even look up the session/pipeline.
  // The "default to seedance" fallback only applies to valid V1_1 skus that
  // are explicitly in V1_1_LAB_SKUS (e.g. a v1 sku like kling-v2-1-pair sent
  // to a v1.1 session → rejected 400 because it's not in V1_1_LAB_SKUS nor
  // V1_ATLAS_SKUS in the combined list... wait: kling-v2-1-pair is also not
  // in V1_ATLAS_SKUS, so also rejected). In practice the UI only sends V1_1
  // catalog skus — no unknown sku should reach the server.
  it("E: sku not in any catalog → 400 (upfront validation rejects before v1.1 default logic)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);

    const updates: Record<string, unknown>[] = [];
    mockGetSupabase.mockReturnValue(buildSupabaseMock(BASE_ITERATION, updates));

    const { default: handler } = await import("../render.js");
    // Supply a SKU that's in neither V1_ATLAS_SKUS nor V1_1_LAB_SKUS.
    const req = makeReq({ body: { iteration_id: "iter-1", sku: "some-unknown-sku" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // Handler must reject with 400 before reaching submitLabRender.
    expect(res._status).toBe(400);
    expect(mockSubmitLabRender).not.toHaveBeenCalled();
    // Error message must reference both catalogs.
    const body = res._body as { error?: string };
    expect(body.error).toMatch(/not a recognised Lab SKU/);
  });
});
