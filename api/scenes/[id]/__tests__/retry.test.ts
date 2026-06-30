/**
 * Tests for POST /api/scenes/:id/retry
 *
 * Core assertion: the update that writes provider/provider_task_id after a
 * successful generateClip MUST also write atlas_model_sku — matching the
 * decision's modelKey when provider === "atlas", null otherwise.  Without
 * this, the cron poll-scenes path attributes cost to the pre-retry SKU.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("../../../../lib/auth.js", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ userId: "admin-1" }),
}));

vi.mock("../../../../lib/db.js", () => ({
  getSupabase: vi.fn(),
  updateScene: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../lib/providers/router.js", () => ({
  selectProviderForScene: vi.fn(),
  buildProviderFromDecision: vi.fn(),
  getEnabledProviders: vi.fn().mockReturnValue(["atlas", "kling"]),
}));

vi.mock("../../../../lib/providers/errors.js", () => ({
  classifyProviderError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import { getSupabase } from "../../../../lib/db.js";
import { selectProviderForScene, buildProviderFromDecision, getEnabledProviders } from "../../../../lib/providers/router.js";
import { classifyProviderError } from "../../../../lib/providers/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: Record<string, unknown> = {}, sceneId = "scene-1"): VercelRequest {
  return {
    method: "POST",
    query: { id: sceneId },
    body: { prompt: "New beautiful prompt for retry", ...body },
  } as unknown as VercelRequest;
}

function makeRes() {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status: vi.fn().mockImplementation((s: number) => { statusCode = s; return res; }),
    json: vi.fn().mockImplementation((b: unknown) => { body = b; return res; }),
    setHeader: vi.fn(),
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as unknown as VercelResponse & { statusCode: number; body: unknown };
  return res;
}

/** Build a minimal fake Supabase client for retry tests. */
function makeSupabase(opts: {
  scene?: Record<string, unknown>;
  photo?: Record<string, unknown>;
  property?: Record<string, unknown>;
  capturedUpdates?: Array<{ table: string; payload: Record<string, unknown> }>;
}) {
  const scene = opts.scene ?? {
    id: "scene-1",
    property_id: "prop-1",
    photo_id: "photo-1",
    scene_number: 1,
    camera_movement: "pan_right",
    duration_seconds: 5,
    attempt_count: 2,
    end_photo_id: null,
  };
  const photo = opts.photo ?? {
    file_url: "https://cdn.example.com/photos/photo-1.jpg",
    room_type: "living_room",
  };
  // Default property: no pin, no v1.1 mode.
  const property = opts.property ?? {
    id: "prop-1",
    pipeline_mode: "v1",
    video_model_sku: null,
  };
  const captured = opts.capturedUpdates ?? [];

  const makeFluent = (table: string) => {
    const b: Record<string, (...args: unknown[]) => unknown> = {};
    b.select = () => b;
    b.eq = (_col: unknown, _val: unknown) => b;
    b.single = () => {
      if (table === "scenes") return Promise.resolve({ data: scene, error: null });
      if (table === "photos") return Promise.resolve({ data: photo, error: null });
      if (table === "properties") return Promise.resolve({ data: property, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    b.update = (payload: Record<string, unknown>) => {
      captured.push({ table, payload });
      return { eq: () => Promise.resolve({ error: null }) };
    };
    return b;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => makeFluent(table)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:id/retry — atlas_model_sku attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEnabledProviders as ReturnType<typeof vi.fn>).mockReturnValue(["atlas", "kling"]);
  });

  it("writes atlas_model_sku=modelKey when decision is atlas", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabase({ capturedUpdates }));

    const atlasSku = "kling-v3-pro";
    const fakeDecision = { provider: "atlas", modelKey: atlasSku };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "atlas-job-1" }),
    });

    const { default: handler } = await import("../retry.js");
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    // Find the submit update (the one that sets status: "generating")
    const submitUpdate = capturedUpdates.find(
      (u) => u.table === "scenes" && u.payload.status === "generating"
    );
    expect(submitUpdate, "submit update not found").toBeDefined();
    expect(submitUpdate!.payload.atlas_model_sku).toBe(atlasSku);
    expect(res.statusCode).toBe(200);
  });

  it("writes atlas_model_sku=null when decision is non-atlas (kling)", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabase({ capturedUpdates }));

    const fakeDecision = { provider: "kling", modelKey: undefined };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "kling",
      generateClip: vi.fn().mockResolvedValue({ jobId: "kling-job-1" }),
    });

    const { default: handler } = await import("../retry.js");
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const submitUpdate = capturedUpdates.find(
      (u) => u.table === "scenes" && u.payload.status === "generating"
    );
    expect(submitUpdate, "submit update not found").toBeDefined();
    expect(submitUpdate!.payload.atlas_model_sku).toBeNull();
    expect(res.statusCode).toBe(200);
  });

  it("nulls atlas_model_sku in the reset step before re-submit", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabase({ capturedUpdates }));

    const fakeDecision = { provider: "atlas", modelKey: "seedance-pro-pushin" };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "atlas-job-2" }),
    });

    const { default: handler } = await import("../retry.js");
    await handler(makeReq(), makeRes());

    // The clear/reset update (sets status: "pending") must also null atlas_model_sku
    const resetUpdate = capturedUpdates.find(
      (u) => u.table === "scenes" && u.payload.status === "pending"
    );
    expect(resetUpdate, "reset update not found").toBeDefined();
    expect(resetUpdate!.payload.atlas_model_sku).toBeNull();
  });

  it("atlas decision with undefined modelKey writes atlas_model_sku=null", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabase({ capturedUpdates }));

    // atlas decision but no modelKey (should coerce to null via ?? null)
    const fakeDecision = { provider: "atlas", modelKey: undefined };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "atlas-job-3" }),
    });

    const { default: handler } = await import("../retry.js");
    await handler(makeReq(), makeRes());

    const submitUpdate = capturedUpdates.find(
      (u) => u.table === "scenes" && u.payload.status === "generating"
    );
    expect(submitUpdate, "submit update not found").toBeDefined();
    expect(submitUpdate!.payload.atlas_model_sku).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Operator listing-pin tests
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:id/retry — operator listing pin (video_model_sku)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEnabledProviders as ReturnType<typeof vi.fn>).mockReturnValue(["atlas", "kling"]);
  });

  it("passes video_model_sku as skuOverride when the property has a pinned SKU", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabase({
        capturedUpdates,
        property: { id: "prop-1", pipeline_mode: "v1", video_model_sku: "kling-v2-master" },
      })
    );

    // selectProviderForScene is what the handler will call; the mock verifies it
    // receives the pinned SKU as its 4th argument.
    const fakeDecision = { provider: "atlas", modelKey: "kling-v2-master" };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "pin-job-1" }),
    });

    const { default: handler } = await import("../retry.js");
    await handler(makeReq(), makeRes());

    // Verify selectProviderForScene was called with skuOverride = "kling-v2-master"
    expect(selectProviderForScene).toHaveBeenCalledWith(
      expect.objectContaining({ roomType: "living_room", movement: "pan_right" }),
      [],           // excluded (first attempt)
      "v1",         // pipelineMode
      "kling-v2-master", // listing pin passed through
    );
  });

  it("routes to pinned SKU and persists atlas_model_sku matching the pin", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabase({
        capturedUpdates,
        property: { id: "prop-1", pipeline_mode: "v1", video_model_sku: "kling-v2-master" },
      })
    );

    const fakeDecision = { provider: "atlas", modelKey: "kling-v2-master" };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "pin-job-2" }),
    });

    const { default: handler } = await import("../retry.js");
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const submitUpdate = capturedUpdates.find(
      (u) => u.table === "scenes" && u.payload.status === "generating"
    );
    expect(submitUpdate, "submit update not found").toBeDefined();
    // atlas_model_sku must reflect the pinned SKU that actually routed
    expect(submitUpdate!.payload.atlas_model_sku).toBe("kling-v2-master");
  });

  it("falls back to automatic routing when the listing has no pinned SKU (null)", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabase({
        capturedUpdates,
        property: { id: "prop-1", pipeline_mode: "v1", video_model_sku: null },
      })
    );

    // Automatic routing returns kling-v3-pro via the movement table
    const fakeDecision = { provider: "atlas", modelKey: "kling-v3-pro" };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "auto-job-1" }),
    });

    const { default: handler } = await import("../retry.js");
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    // skuOverride must be null → automatic routing
    expect(selectProviderForScene).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      "v1",
      null, // no pin
    );
  });

  it("falls back to automatic routing when the listing SKU is unset (undefined property)", async () => {
    const capturedUpdates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabase({
        capturedUpdates,
        // property row has no video_model_sku key at all
        property: { id: "prop-1", pipeline_mode: "v1" },
      })
    );

    const fakeDecision = { provider: "atlas", modelKey: "kling-v2-6-pro" };
    (selectProviderForScene as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
    (buildProviderFromDecision as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "atlas",
      generateClip: vi.fn().mockResolvedValue({ jobId: "auto-job-2" }),
    });

    const { default: handler } = await import("../retry.js");
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(selectProviderForScene).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      "v1",
      null, // undefined ?? null → null
    );
  });
});
