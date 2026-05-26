/**
 * render-v1.1.test.ts
 *
 * Verifies that POST /api/admin/prompt-lab/render applies v1.1 overrides when
 * the parent session has pipeline_version='v1.1':
 *
 *   1. submitLabRender is called with pipelineVersion='v1.1'.
 *   2. The UPDATE to prompt_lab_iterations carries model_used='seedance-pro-pushin'
 *      and pipeline_version='v1.1'.
 *
 * v1 sessions (default) must be unaffected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── submitLabRender mock ─────────────────────────────────────────────────────
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

// ── Atlas SKU mock ────────────────────────────────────────────────────────────
vi.mock("../../../../lib/providers/atlas", () => ({
  V1_ATLAS_SKUS: ["kling-v2-6-pro", "kling-v2-master"],
}));

// ── Supabase chainable mock ───────────────────────────────────────────────────
type ChainResult = { data: unknown; error: unknown };

function makeChain(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = self; chain.select = self; chain.eq = self; chain.single = () => Promise.resolve(result);
  chain.update = self; chain.insert = self; chain.maybeSingle = () => Promise.resolve(result);
  chain.is = self; chain.not = self; chain.order = self; chain.limit = self;
  // Allow chained .select().single() after .update()
  chain.select = () => ({ single: () => Promise.resolve(result), ...chain });
  return chain;
}

// We need a more sophisticated mock that can handle different table calls.
function makeSupabaseMock(opts: {
  iteration: unknown;
  sessionPipelineVersion?: string;
  updateResult?: unknown;
  shadowLogResult?: unknown;
}) {
  const iterRow = opts.iteration as Record<string, unknown>;
  // Attach session pipeline_version onto the nested join object
  const iterWithSession = {
    ...iterRow,
    prompt_lab_sessions: {
      image_url: "https://example.com/img.jpg",
      pipeline_version: opts.sessionPipelineVersion ?? "v1",
    },
  };

  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  let callIndex = 0;

  const updateCapture: Record<string, unknown> = {};

  const mockChain = {
    _table: "",
    _op: "",
    from(table: string) { this._table = table; return this; },
    select(_fields?: string) { return this; },
    eq(_col: string, _val: unknown) { return this; },
    single() {
      if (this._table === "prompt_lab_iterations" && callIndex === 0) {
        callIndex++;
        return Promise.resolve({ data: iterWithSession, error: null });
      }
      return Promise.resolve({ data: iterWithSession, error: null });
    },
    update(payload: Record<string, unknown>) {
      Object.assign(updateCapture, payload);
      return {
        eq: (_col: string, _val: unknown) => ({
          select: () => ({
            single: () => Promise.resolve({ data: { ...iterWithSession, ...payload }, error: null }),
          }),
        }),
      };
    },
    insert(_payload: unknown) {
      return { select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) };
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://storage.example.com/clip.mp4" } }),
      }),
    },
  };

  return { chain: mockChain, updateCapture };
}

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

// A base iteration row (no clip, no task yet).
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
};

// ── Tests ─────────────────────────────────────────────────────────────────────

let importedHandler: (req: VercelRequest, res: VercelResponse) => Promise<void>;

beforeEach(async () => {
  mockRequireAdmin.mockReset();
  mockSubmitLabRender.mockReset();
  mockGetSupabase.mockReset();
  // Re-import handler fresh each test to get the latest mocks
  vi.resetModules();
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
  }));
  vi.mock("../../../../lib/client", () => ({
    getSupabase: () => mockGetSupabase(),
  }));
});

describe("render.ts — v1.1 pipeline_version override", () => {
  it("calls submitLabRender with pipelineVersion='v1.1' when session is v1.1", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-123",
      provider: "atlas",
      sku: "seedance-pro-pushin",
      staticSku: "seedance-pro-pushin",
      thompson: undefined,
    });

    const iterWithSession = {
      ...BASE_ITERATION,
      prompt_lab_sessions: {
        image_url: "https://example.com/img.jpg",
        pipeline_version: "v1.1",
      },
    };

    // Supabase mock: first .single() returns iteration+session,
    // subsequent .update() chains succeed.
    const updates: Record<string, unknown>[] = [];
    const supabaseMock = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(
                table === "prompt_lab_iterations"
                  ? { data: iterWithSession, error: null }
                  : { data: null, error: null }
              ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, ...payload });
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({
                    data: { ...iterWithSession, ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
        };
      },
    };
    mockGetSupabase.mockReturnValue(supabaseMock);

    const { default: handler } = await import("../render.js");
    const req = makeReq({
      body: { iteration_id: "iter-1", provider: "kling", sku: "kling-v2-6-pro" },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    // submitLabRender must have been called with pipelineVersion='v1.1'
    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1.1");

    // User-supplied provider override must be nulled out for v1.1
    expect(callArgs.providerOverride).toBeNull();

    // The update to prompt_lab_iterations must carry pipeline_version='v1.1'
    // and model_used='seedance-pro-pushin'
    const iterUpdate = updates.find((u) => u.table === "prompt_lab_iterations" && u.model_used);
    expect(iterUpdate?.model_used).toBe("seedance-pro-pushin");
    expect(iterUpdate?.pipeline_version).toBe("v1.1");
  });

  it("does NOT override when session is v1 (existing behavior unchanged)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-456",
      provider: "atlas",
      sku: "kling-v2-6-pro",
      staticSku: "kling-v2-6-pro",
      thompson: undefined,
    });

    const iterWithSession = {
      ...BASE_ITERATION,
      prompt_lab_sessions: {
        image_url: "https://example.com/img.jpg",
        pipeline_version: "v1",
      },
    };

    const updates: Record<string, unknown>[] = [];
    const supabaseMock = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(
                table === "prompt_lab_iterations"
                  ? { data: iterWithSession, error: null }
                  : { data: null, error: null }
              ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, ...payload });
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({
                    data: { ...iterWithSession, ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
        };
      },
    };
    mockGetSupabase.mockReturnValue(supabaseMock);

    const { default: handler } = await import("../render.js");
    const req = makeReq({
      body: { iteration_id: "iter-1", sku: "kling-v2-6-pro" },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(mockSubmitLabRender).toHaveBeenCalledOnce();
    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    // v1: pipelineVersion should be 'v1' (not null)
    expect(callArgs.pipelineVersion).toBe("v1");
    // v1: should not force null providerOverride from our code
    // (original behavior passes providerOverride through)

    // The update carries pipeline_version='v1'
    const iterUpdate = updates.find((u) => u.table === "prompt_lab_iterations" && u.model_used);
    expect(iterUpdate?.pipeline_version).toBe("v1");
  });

  it("defaults to v1 when session has no pipeline_version (pre-migration)", async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockSubmitLabRender.mockResolvedValue({
      jobId: "atlas-job-789",
      provider: "atlas",
      sku: "kling-v2-6-pro",
      staticSku: "kling-v2-6-pro",
    });

    // Simulate old session row without pipeline_version column
    const iterWithSession = {
      ...BASE_ITERATION,
      prompt_lab_sessions: {
        image_url: "https://example.com/img.jpg",
        // pipeline_version absent (pre-migration-067)
      },
    };

    const updates: Record<string, unknown>[] = [];
    const supabaseMock = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(
                table === "prompt_lab_iterations"
                  ? { data: iterWithSession, error: null }
                  : { data: null, error: null }
              ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, ...payload });
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: payload, error: null }),
                }),
              }),
            };
          },
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
        };
      },
    };
    mockGetSupabase.mockReturnValue(supabaseMock);

    const { default: handler } = await import("../render.js");
    const req = makeReq({ body: { iteration_id: "iter-1" } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    const callArgs = mockSubmitLabRender.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.pipelineVersion).toBe("v1");
  });
});
