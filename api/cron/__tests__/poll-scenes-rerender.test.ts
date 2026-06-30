/**
 * Tests for poll-scenes cron — QC re-render loop.
 *
 * When the Gemini judge hard-rejects a clip with shouldRerender:true, the cron
 * must re-submit the scene (via resubmitScene) with corrective feedback derived
 * from the judge's hallucination_flags, capped at MAX_QC_RERENDERS. Below the
 * cap → resubmit, don't write qc_hard_reject. At the cap → no resubmit, write
 * needs_review. Judge disabled (judgeRan:false) → no resubmit, qc_pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("../../../lib/qc/judge-scene.js", () => ({
  judgeProductionScene: vi.fn(),
}));

vi.mock("../../../lib/db.js", () => ({
  getSupabase: vi.fn(),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/providers/router.js", () => ({
  selectProvider: vi.fn(),
  buildProviderFromDecision: vi.fn(),
}));

// runAssembly (finalize) + resubmitScene (re-render) both live in pipeline.js.
vi.mock("../../../lib/pipeline.js", () => ({
  runAssembly: vi.fn().mockResolvedValue(undefined),
  resubmitScene: vi.fn(),
}));

// Mock stuck-reaper so its from('scenes') calls don't interfere with this
// test's counter-based Supabase mock. The reaper is exercised by its own
// dedicated test suite; here it must be a no-op.
vi.mock("../../../lib/pipeline/stuck-reaper.js", () => ({
  reapStuckScenes: vi.fn().mockResolvedValue({ reaped: 0, ids: [] }),
}));

import { judgeProductionScene } from "../../../lib/qc/judge-scene.js";
import { getSupabase } from "../../../lib/db.js";
import { selectProvider } from "../../../lib/providers/router.js";
import { resubmitScene } from "../../../lib/pipeline.js";

// ---------------------------------------------------------------------------
// Helpers (mirror poll-scenes.test.ts)
// ---------------------------------------------------------------------------

function makeScene(overrides: Record<string, unknown> = {}) {
  return {
    id: "scene-1",
    property_id: "prop-1",
    photo_id: "photo-1",
    scene_number: 1,
    provider: "kling",
    provider_task_id: "task-abc",
    duration_seconds: 5,
    attempt_count: 1,
    submitted_at: new Date(Date.now() - 60_000).toISOString(),
    prompt: "Slow pan across the living room",
    camera_movement: "pan_right",
    room_type: "living_room",
    ...overrides,
  };
}

function makeSupabase(opts: {
  scene: ReturnType<typeof makeScene>;
  photoFileUrl?: string;
  capturedSceneUpdate: { payload: Record<string, unknown> | null; count: number; all: Record<string, unknown>[] };
}) {
  const { scene, capturedSceneUpdate } = opts;
  const photoFileUrl = opts.photoFileUrl ?? "https://cdn.example.com/photos/photo-1.jpg";

  let scenesSelectCallCount = 0;

  const storageBuilder = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: "https://storage.example.com/clips/scene_1_v1.mp4" },
    }),
  };

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "property-videos") return storageBuilder;

    if (table === "scenes") {
      scenesSelectCallCount++;
      if (scenesSelectCallCount === 1) {
        const builder: Record<string, unknown> = {};
        builder.select = (_cols: string) => builder;
        builder.not = () => builder;
        builder.is = () => builder;
        builder.order = () => builder;
        builder.limit = () => Promise.resolve({ data: [scene], error: null });
        builder.update = (payload: Record<string, unknown>) => {
          capturedSceneUpdate.payload = payload;
          capturedSceneUpdate.count++;
          capturedSceneUpdate.all.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        };
        return builder;
      }
      // Finalize re-select: report the scene as still in flight after a
      // re-render (provider_task_id set, no clip_url) so the property does
      // NOT finalize in the rerender case. In the non-rerender (cap) case the
      // scene is needs_review which lets the property finalize.
      const settledScene = scenesSettledRow;
      const finalizeBuilder: Record<string, unknown> = {};
      finalizeBuilder.select = () => ({
        eq: () => Promise.resolve({ data: [settledScene], error: null }),
      });
      finalizeBuilder.update = (payload: Record<string, unknown>) => {
        capturedSceneUpdate.payload = payload;
        capturedSceneUpdate.count++;
        capturedSceneUpdate.all.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return finalizeBuilder;
    }

    if (table === "photos") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ id: scene.photo_id, file_url: photoFileUrl }],
              error: null,
            }),
        }),
      };
    }

    if (table === "properties") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { status: "generating", created_at: new Date().toISOString(), pipeline_started_at: null },
                error: null,
              }),
          }),
        }),
      };
    }

    if (table === "delivery_runs") {
      // Task 11 gate: no delivery run → customer flow unchanged.
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.neq = () => chain;
      chain.in = () => Promise.resolve({ data: [], error: null });
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return chain;
    }

    return {
      select: () => Promise.resolve({ data: [], error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
  });

  // Mutable settle row consumed by the finalize re-select. Default: in flight.
  let scenesSettledRow: Record<string, unknown> = {
    status: "generating",
    clip_url: null,
    provider_task_id: "fresh-task",
  };

  return {
    client: { from, storage: { from } },
    setSettledRow(row: Record<string, unknown>) {
      scenesSettledRow = row;
    },
  };
}

function makeReqRes() {
  const req = { method: "GET" } as VercelRequest;
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(b: unknown) { body = b; return res; },
    setHeader: vi.fn(),
  } as unknown as VercelResponse;
  return { req, res, getStatus: () => statusCode, getBody: () => body };
}

function makeProvider(providerName = "kling") {
  return {
    name: providerName,
    checkStatus: vi.fn().mockResolvedValue({
      status: "completed",
      videoUrl: "https://provider.example.com/raw-clip.mp4",
      costCents: 0,
      providerUnits: 10,
      providerUnitType: "kling_units",
    }),
    downloadClip: vi.fn().mockResolvedValue(Buffer.from("fake-video-bytes")),
  };
}

const HARD_REJECT_RUBRIC = {
  overall: 1,
  motion_quality: 2,
  prompt_adherence: 1,
  geometry_coherence: 1,
  room_consistency: 5,
  hallucination_flags: ["hallucinated_geometry", "camera_exited_room"],
  notes: "walls warped",
};

describe("poll-scenes — QC re-render loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_QC_RERENDERS;
  });
  afterEach(() => {
    delete process.env.MAX_QC_RERENDERS;
  });

  it("hard-reject + shouldRerender + attempt_count below cap → resubmitScene called with promptSuffix; scene NOT written qc_hard_reject", async () => {
    const scene = makeScene({ attempt_count: 1 });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null, count: 0, all: [] as Record<string, unknown>[] };
    const sb = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(sb.client as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(resubmitScene).mockResolvedValue({ ok: true, provider: "atlas", jobId: "fresh-task" });
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: "fabrication_flag:hallucinated_geometry",
      judgeRan: true,
      rubric: HARD_REJECT_RUBRIC,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);

    // resubmitScene must be called for this scene with a corrective promptSuffix.
    expect(resubmitScene).toHaveBeenCalledTimes(1);
    const [calledSceneId, calledOpts] = vi.mocked(resubmitScene).mock.calls[0];
    expect(calledSceneId).toBe(scene.id);
    expect(typeof calledOpts?.promptSuffix).toBe("string");
    expect(calledOpts?.promptSuffix).toContain("hallucinated_geometry");

    // The scene must NOT have been stamped qc_hard_reject in the completion
    // branch (resubmitScene already moved it back to generating). No scenes
    // update payload in this tick should set status:'qc_hard_reject'.
    const wroteHardReject = capturedSceneUpdate.all.some(
      (p) => p.status === "qc_hard_reject",
    );
    expect(wroteHardReject).toBe(false);
  });

  it("hard-reject + shouldRerender + attempt_count at cap → resubmitScene NOT called; scene written needs_review", async () => {
    process.env.MAX_QC_RERENDERS = "2";
    const scene = makeScene({ attempt_count: 2 });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null, count: 0, all: [] as Record<string, unknown>[] };
    const sb = makeSupabase({ scene, capturedSceneUpdate });
    // After cap, scene settles as needs_review so the property can finalize.
    sb.setSettledRow({ status: "needs_review", clip_url: "https://storage.example.com/clips/scene_1_v1.mp4", provider_task_id: null });

    vi.mocked(getSupabase).mockReturnValue(sb.client as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(resubmitScene).mockResolvedValue({ ok: true });
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: "fabrication_flag:hallucinated_geometry",
      judgeRan: true,
      rubric: HARD_REJECT_RUBRIC,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(resubmitScene).not.toHaveBeenCalled();

    // Completion-path scene update should set status:'needs_review'.
    expect(capturedSceneUpdate.payload).not.toBeNull();
    expect(capturedSceneUpdate.payload!.status).toBe("needs_review");
  });

  it("judgeRan:false (disabled) → no resubmit, status:'qc_pass' — back-compat preserved", async () => {
    const scene = makeScene({ attempt_count: 1 });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null, count: 0, all: [] as Record<string, unknown>[] };
    const sb = makeSupabase({ scene, capturedSceneUpdate });
    sb.setSettledRow({ status: "qc_pass", clip_url: "https://storage.example.com/clips/scene_1_v1.mp4", provider_task_id: null });

    vi.mocked(getSupabase).mockReturnValue(sb.client as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(resubmitScene).mockResolvedValue({ ok: true });
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass",
      shouldRerender: false,
      reason: "judge_disabled",
      judgeRan: false,
      rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(resubmitScene).not.toHaveBeenCalled();
    expect(capturedSceneUpdate.payload).not.toBeNull();
    expect(capturedSceneUpdate.payload!.status).toBe("qc_pass");
    expect(capturedSceneUpdate.payload!.qc_verdict).toBe("auto_pass");
  });
});
