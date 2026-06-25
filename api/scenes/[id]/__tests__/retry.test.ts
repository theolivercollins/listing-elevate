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
  selectDecision: vi.fn(),
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
import { selectDecision, buildProviderFromDecision, getEnabledProviders } from "../../../../lib/providers/router.js";
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
  };
  const photo = opts.photo ?? {
    file_url: "https://cdn.example.com/photos/photo-1.jpg",
    room_type: "living_room",
  };
  const captured = opts.capturedUpdates ?? [];

  const makeFluent = (table: string) => {
    const b: Record<string, (...args: unknown[]) => unknown> = {};
    b.select = () => b;
    b.eq = (_col: unknown, _val: unknown) => b;
    b.single = () => Promise.resolve({ data: table === "scenes" ? scene : photo, error: null });
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
    (selectDecision as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
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
    (selectDecision as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
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
    (selectDecision as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
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
    (selectDecision as ReturnType<typeof vi.fn>).mockReturnValue(fakeDecision);
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
