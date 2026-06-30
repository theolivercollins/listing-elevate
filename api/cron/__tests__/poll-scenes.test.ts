/**
 * Tests for poll-scenes cron — judge wiring.
 *
 * The handler uses dynamic import() for its dependencies.  vi.mock hoisting
 * intercepts those before they execute, so we can fully control the
 * judgeProductionScene call and Supabase interactions without hitting the
 * network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

// Mock judge-scene so we can control verdict without a real Gemini call.
vi.mock("../../../lib/qc/judge-scene.js", () => ({
  judgeProductionScene: vi.fn(),
}));

// Mock db to avoid real Supabase connections.
vi.mock("../../../lib/db.js", () => ({
  getSupabase: vi.fn(),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock providers/router.js.
vi.mock("../../../lib/providers/router.js", () => ({
  selectProvider: vi.fn(),
  buildProviderFromDecision: vi.fn(),
}));

// Mock pipeline (runAssembly in the finalize path; resubmitScene in the QC
// re-render path). These tests don't exercise the re-render branch, so a
// default no-op resubmitScene is sufficient.
vi.mock("../../../lib/pipeline.js", () => ({
  runAssembly: vi.fn().mockResolvedValue(undefined),
  resubmitScene: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock stuck-reaper so its from('scenes') calls don't interfere with this
// test's counter-based Supabase mock. The reaper is exercised by its own
// dedicated test suite; here it must be a no-op.
vi.mock("../../../lib/pipeline/stuck-reaper.js", () => ({
  reapStuckScenes: vi.fn().mockResolvedValue({ reaped: 0, ids: [] }),
}));

// Mock Bunny Stream — video hosting target since 2026-06-12. Default: NOT
// configured, so the existing judge-wiring tests exercise the graceful
// provider-URL fallback (clip_url := status.videoUrl). The dedicated Bunny test
// overrides isBunnyConfigured → true to exercise the host path.
vi.mock("../../../lib/providers/bunny-stream.js", () => ({
  isBunnyConfigured: vi.fn().mockReturnValue(false),
  hostVideoOnBunny: vi.fn(async (title: string) => ({
    guid: "guid",
    mp4Url: `https://bunny.example.com/${encodeURIComponent(title)}/play_720p.mp4`,
    hlsUrl: `https://bunny.example.com/${encodeURIComponent(title)}/playlist.m3u8`,
    status: 4,
  })),
  bunnyStreamCostCents: vi.fn().mockReturnValue(0),
  deleteBunnyVideo: vi.fn().mockResolvedValue(undefined),
  // validateBunnyMp4Url defaults true; individual tests that test the
  // HEAD-failure path stub fetch globally via vi.stubGlobal("fetch", ...).
  validateBunnyMp4Url: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import { judgeProductionScene } from "../../../lib/qc/judge-scene.js";
import { getSupabase, recordCostEvent, log } from "../../../lib/db.js";
import { selectProvider, buildProviderFromDecision } from "../../../lib/providers/router.js";
import { resubmitScene } from "../../../lib/pipeline.js";
import { isBunnyConfigured, hostVideoOnBunny, deleteBunnyVideo, validateBunnyMp4Url } from "../../../lib/providers/bunny-stream.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal scene row matching what poll-scenes selects (including new cols). */
function makeScene(overrides: Partial<{
  id: string;
  property_id: string;
  photo_id: string;
  scene_number: number;
  provider: string;
  provider_task_id: string;
  duration_seconds: number;
  attempt_count: number;
  submitted_at: string;
  prompt: string;
  camera_movement: string;
  room_type: string;
  atlas_model_sku: string | null;
}> = {}) {
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
    atlas_model_sku: null,
    ...overrides,
  };
}

/**
 * Build a fake Supabase client that drives the full poll-scenes handler.
 *
 * We need to handle multiple `.from()` calls:
 *   1. `scenes` — the pending query returns `[scene]`
 *   2. `property-videos` storage upload + getPublicUrl
 *   3. `scenes` update — capture the update payload
 *   4. `scenes` finalize re-select (status check after loop)
 *   5. `properties` single fetch (finalize guard)
 *   6. `photos` — lookup file_url for source photo
 *
 * We track the update payload via `capturedSceneUpdate`.
 */
function makeSupabase(opts: {
  scene: ReturnType<typeof makeScene>;
  photoFileUrl?: string;
  capturedSceneUpdate: { payload: Record<string, unknown> | null };
}) {
  const { scene, capturedSceneUpdate } = opts;
  const photoFileUrl = opts.photoFileUrl ?? "https://cdn.example.com/photos/photo-1.jpg";

  // Builder that tracks scene updates.
  const scenesUpdateBuilder = {
    _payload: null as Record<string, unknown> | null,
    update(payload: Record<string, unknown>) {
      capturedSceneUpdate.payload = payload;
      return this;
    },
    eq(_key: string, _val: unknown) { return Promise.resolve({ error: null }); },
  };

  // For the scenes finalize re-select (after main loop).
  let scenesSelectCallCount = 0;

  const storageBuilder = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: "https://storage.example.com/clips/scene_1_v1.mp4" },
    }),
  };

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "property-videos") {
      return storageBuilder;
    }

    if (table === "scenes") {
      // First call: the pending select.
      // Subsequent calls: finalize re-select returning settled scenes.
      scenesSelectCallCount++;
      if (scenesSelectCallCount === 1) {
        // Return the fluent chain for the initial pending query.
        const builder: Record<string, unknown> = {};
        builder.select = (_cols: string) => builder;
        builder.not = (_col: string, _op: string, _val: unknown) => builder;
        builder.is = (_col: string, _val: unknown) => builder;
        builder.order = (_col: string, _opts: unknown) => builder;
        builder.limit = (_n: number) =>
          Promise.resolve({ data: [scene], error: null });
        builder.update = (payload: Record<string, unknown>) => {
          capturedSceneUpdate.payload = payload;
          return {
            eq: (_k: string, _v: unknown) => Promise.resolve({ error: null }),
          };
        };
        return builder;
      }
      // Finalize re-select: all scenes settled as qc_pass.
      // The finalize code does: supabase.from('scenes').select(...).eq('property_id', id)
      // So select() must return a chainable builder, not a Promise directly.
      const settledScene = { status: "qc_pass", clip_url: "https://storage.example.com/clips/scene_1_v1.mp4", provider_task_id: null };
      const finalizeBuilder: Record<string, unknown> = {};
      finalizeBuilder.select = (_cols: string) => ({
        eq: (_col: string, _val: unknown) =>
          Promise.resolve({ data: [settledScene], error: null }),
      });
      finalizeBuilder.update = (payload: Record<string, unknown>) => {
        capturedSceneUpdate.payload = payload;
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return finalizeBuilder;
    }

    if (table === "photos") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) =>
            Promise.resolve({
              data: [{ id: scene.photo_id, file_url: photoFileUrl }],
              error: null,
            }),
        }),
      };
    }

    if (table === "properties") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => ({
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

    // Default: no-op builder.
    return {
      select: () => Promise.resolve({ data: [], error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
  });

  return { from, storage: { from } };
}

/** Minimal req/res pair for the Vercel handler. */
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

/** Build a fake provider that returns a completed clip. */
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("poll-scenes — Gemini judge wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MAX_QC_RERENDERS;
    // Reset Bunny config to the default-unconfigured state so the judge-wiring
    // tests exercise the provider-URL fallback; the Bunny-host tests opt in.
    vi.mocked(isBunnyConfigured).mockReturnValue(false);
    // clearAllMocks resets the validateBunnyMp4Url implementation; restore the
    // default (HEAD passes) so Bunny-host tests that set isBunnyConfigured=true
    // don't have to repeat this setup.
    vi.mocked(validateBunnyMp4Url).mockResolvedValue(true);
  });

  it("qc_hard_reject at re-render cap: scene gets status:'needs_review', qc_verdict:'qc_hard_reject', qc_issues with flags", async () => {
    // attempt_count at the cap (2) means no re-render is left — the scene is
    // finalized for review with the judge's hard-reject verdict + flags. (The
    // under-cap re-render path is covered in poll-scenes-rerender.test.ts.)
    process.env.MAX_QC_RERENDERS = "2";
    const scene = makeScene({ attempt_count: 2 });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_hard_reject",
      shouldRerender: true,
      reason: "fabrication_flag:hallucinated_geometry",
      judgeRan: true,
      rubric: {
        overall: 1,
        motion_quality: 2,
        prompt_adherence: 1,
        geometry_coherence: 1,
        room_consistency: 5,
        hallucination_flags: ["hallucinated_geometry"],
        notes: "walls warped",
      },
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(resubmitScene).not.toHaveBeenCalled();
    expect(capturedSceneUpdate.payload).not.toBeNull();

    const update = capturedSceneUpdate.payload!;
    // Cap reached → surface for review rather than dangling at hard-reject.
    expect(update.status).toBe("needs_review");
    expect(update.qc_verdict).toBe("qc_hard_reject");
    // qc_issues should carry the flags in the dashboard-consumed shape
    expect((update.qc_issues as { issues: string[] }).issues).toEqual(["hallucinated_geometry"]);
    // qc_confidence should be rubric.overall / 5 = 1/5 = 0.2
    expect(update.qc_confidence).toBeCloseTo(0.2, 5);
    // clip_url must still be stored
    expect(typeof update.clip_url).toBe("string");

    // judgeProductionScene was called with correct inputs
    expect(judgeProductionScene).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: scene.id,
        directorPrompt: scene.prompt,
        cameraMovement: scene.camera_movement,
        roomType: scene.room_type,
        sourcePhotoUrl: "https://cdn.example.com/photos/photo-1.jpg",
      }),
    );
  });

  it("judgeRan:false (judge disabled) → status:'qc_pass', qc_verdict:'auto_pass' — back-compat preserved", async () => {
    const scene = makeScene();
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
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
    expect(capturedSceneUpdate.payload).not.toBeNull();

    const update = capturedSceneUpdate.payload!;
    // Back-compat: judgeRan:false → qc_verdict:'auto_pass' and status:'qc_pass'
    expect(update.status).toBe("qc_pass");
    expect(update.qc_verdict).toBe("auto_pass");
    expect(update.qc_confidence).toBe(1.0);
    expect(update.qc_issues).toBeNull();
  });

  it("qc_soft_reject: scene gets status:'needs_review', qc_verdict:'qc_soft_reject'", async () => {
    const scene = makeScene();
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_soft_reject",
      shouldRerender: false,
      reason: "overall:2",
      judgeRan: true,
      rubric: {
        overall: 2,
        motion_quality: 3,
        prompt_adherence: 3,
        geometry_coherence: 4,
        room_consistency: 4,
        hallucination_flags: [],
        notes: "low quality",
      },
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const update = capturedSceneUpdate.payload!;
    expect(update.status).toBe("needs_review");
    expect(update.qc_verdict).toBe("qc_soft_reject");
    expect(update.qc_confidence).toBeCloseTo(2 / 5, 5);
    expect(update.qc_issues).toBeNull(); // no hallucination flags
  });

  it("hosts the completed clip on Bunny Stream and stores the Bunny mp4 URL as clip_url (provider:'bunny' cost_event emitted)", async () => {
    // Bunny configured → the collected clip is hosted on Bunny and clip_url is the
    // returned CDN mp4 URL, NOT a Supabase Storage URL.
    // validateBunnyMp4Url defaults to true (mock default) → mp4Url is valid;
    // clip_url must be the Bunny CDN URL.
    vi.mocked(isBunnyConfigured).mockReturnValue(true);
    const scene = makeScene();
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled",
      judgeRan: false, rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    // Bunny host was invoked with the old clipPath as the title.
    expect(vi.mocked(hostVideoOnBunny)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hostVideoOnBunny).mock.calls[0][0]).toMatch(/scene_1_v1\.mp4$/);
    // clip_url is the Bunny CDN mp4 URL (HEAD 200 → mp4Valid=true).
    const update = capturedSceneUpdate.payload!;
    expect(update.clip_url).toMatch(/^https:\/\/bunny\.example\.com\//);
    // A provider:'bunny' cost_event was emitted: bunny_hosted:true (HEAD passed).
    expect(vi.mocked(recordCostEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "bunny", unitType: "renders", metadata: expect.objectContaining({ bunny_hosted: true, source: "cron" }) }),
    );
  });

  it("HEAD-404: falls back to provider URL, emits bunny_hosted:false cost row, calls deleteBunnyVideo with hosted guid", async () => {
    // Bunny upload succeeds but HEAD check returns 404 (MP4 Fallback disabled on
    // the library). validateBunnyMp4Url now sends the Referer header and returns
    // a boolean — control it directly via the mock so tests aren't coupled to
    // global fetch behavior.
    // poll-scenes must: (1) keep clip_url = provider URL, (2) emit exactly one
    // bunny cost row with bunny_hosted:false, (3) call deleteBunnyVideo to clean
    // up the orphaned video object. Zero-HITL: handler must return 200.
    vi.mocked(isBunnyConfigured).mockReturnValue(true);
    // Simulate HEAD returning 403/404 (referrer mismatch or MP4 Fallback disabled).
    vi.mocked(validateBunnyMp4Url).mockResolvedValueOnce(false);
    const scene = makeScene();
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled",
      judgeRan: false, rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    // Handler must not throw — zero-HITL.
    expect(getStatus()).toBe(200);

    // clip_url falls back to the provider URL (Bunny URL was 404).
    const update = capturedSceneUpdate.payload!;
    expect(update.clip_url).toBe("https://provider.example.com/raw-clip.mp4");

    // Exactly one Bunny cost row, with bunny_hosted:false (HEAD failed).
    const bunnyCalls = vi.mocked(recordCostEvent).mock.calls.filter(
      ([args]) => args.provider === "bunny",
    );
    expect(bunnyCalls).toHaveLength(1);
    expect(bunnyCalls[0][0].metadata).toEqual(
      expect.objectContaining({ bunny_hosted: false, source: "cron" }),
    );

    // Orphan cleanup: deleteBunnyVideo called with the hosted guid.
    expect(vi.mocked(deleteBunnyVideo)).toHaveBeenCalledWith("guid");
  });

  it("falls back to the provider videoUrl when Bunny host throws — no throw out of the cron", async () => {
    vi.mocked(isBunnyConfigured).mockReturnValue(true);
    vi.mocked(hostVideoOnBunny).mockRejectedValueOnce(new Error("Bunny 500"));
    const scene = makeScene();
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    vi.mocked(selectProvider).mockReturnValue(makeProvider() as never);
    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled",
      judgeRan: false, rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    // Handler returned 200 (did not throw); clip_url fell back to the provider URL.
    expect(getStatus()).toBe(200);
    const update = capturedSceneUpdate.payload!;
    expect(update.clip_url).toBe("https://provider.example.com/raw-clip.mp4");
  });
});

// ---------------------------------------------------------------------------
// Poll-side SKU reconstruction — the core cost-attribution bug fix
// ---------------------------------------------------------------------------
// These tests verify that the POLL path uses buildProviderFromDecision (not
// selectProvider) when atlas_model_sku is stored, so checkStatus returns the
// rendered SKU's priceCentsPerClip rather than the env-default price.

describe("poll-scenes — Atlas SKU reconstruction for cost attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MAX_QC_RERENDERS;
    vi.mocked(isBunnyConfigured).mockReturnValue(false);
    vi.mocked(validateBunnyMp4Url).mockResolvedValue(true);
  });

  it("kling-v2-master SKU stored: uses buildProviderFromDecision, records costCents=111, never calls selectProvider", async () => {
    // kling-v2-master costs 111¢ per 5s clip (atlas.ts ATLAS_MODELS).
    // The bug: selectProvider yields AtlasProvider(undefined) → env-default price.
    // The fix: atlas_model_sku → buildProviderFromDecision → AtlasProvider('kling-v2-master')
    //          → checkStatus returns 111¢.
    const scene = makeScene({
      provider: "atlas",
      provider_task_id: "atlas-task-xyz",
      atlas_model_sku: "kling-v2-master",
    });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);

    // buildProviderFromDecision returns a provider whose checkStatus reports 111¢
    // — the cost for kling-v2-master (priceCentsPerClip in atlas.ts).
    const atlasProvider = {
      name: "atlas",
      checkStatus: vi.fn().mockResolvedValue({
        status: "completed",
        videoUrl: "https://provider.example.com/atlas-clip.mp4",
        costCents: 111,        // kling-v2-master price
        providerUnits: undefined,
        providerUnitType: undefined,
      }),
      downloadClip: vi.fn().mockResolvedValue(Buffer.from("fake-atlas-video")),
    };
    vi.mocked(buildProviderFromDecision).mockReturnValue(atlasProvider as never);

    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled",
      judgeRan: false, rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);

    // buildProviderFromDecision must have been called with kling-v2-master.
    expect(vi.mocked(buildProviderFromDecision)).toHaveBeenCalledWith({
      provider: "atlas",
      modelKey: "kling-v2-master",
      fallback: undefined,
    });
    // selectProvider must NOT have been called — we bypassed it via buildProviderFromDecision.
    expect(vi.mocked(selectProvider)).not.toHaveBeenCalled();

    // The cost_events row must record 111¢ (the rendered SKU's price).
    const renderCostCalls = vi.mocked(recordCostEvent).mock.calls.filter(
      ([args]) => args.provider === "atlas",
    );
    expect(renderCostCalls.length).toBeGreaterThanOrEqual(1);
    expect(renderCostCalls[0][0].costCents).toBe(111);
  });

  it("null atlas_model_sku (legacy row): falls back to selectProvider without crashing", async () => {
    // Pre-migration rows have atlas_model_sku=null. The fix must keep the
    // existing selectProvider path intact — not crash, not record 0¢.
    const scene = makeScene({
      provider: "atlas",
      provider_task_id: "atlas-task-legacy",
      atlas_model_sku: null,
    });
    const capturedSceneUpdate = { payload: null as Record<string, unknown> | null };
    const fakeSupabase = makeSupabase({ scene, capturedSceneUpdate });

    vi.mocked(getSupabase).mockReturnValue(fakeSupabase as never);
    // selectProvider returns the env-default atlas provider (48¢ for kling-v2-6-pro).
    vi.mocked(selectProvider).mockReturnValue({
      name: "atlas",
      checkStatus: vi.fn().mockResolvedValue({
        status: "completed",
        videoUrl: "https://provider.example.com/atlas-clip.mp4",
        costCents: 48,
        providerUnits: undefined,
        providerUnitType: undefined,
      }),
      downloadClip: vi.fn().mockResolvedValue(Buffer.from("fake-atlas-video")),
    } as never);

    vi.mocked(judgeProductionScene).mockResolvedValue({
      verdict: "qc_pass", shouldRerender: false, reason: "judge_disabled",
      judgeRan: false, rubric: null,
    });

    const { default: handler } = await import("../poll-scenes.js");
    const { req, res, getStatus } = makeReqRes();
    await handler(req, res);

    expect(getStatus()).toBe(200);
    // Legacy path: selectProvider was used, buildProviderFromDecision was NOT.
    expect(vi.mocked(selectProvider)).toHaveBeenCalled();
    expect(vi.mocked(buildProviderFromDecision)).not.toHaveBeenCalled();
    // Cost recorded without crash.
    const renderCostCalls = vi.mocked(recordCostEvent).mock.calls.filter(
      ([args]) => args.provider === "atlas",
    );
    expect(renderCostCalls.length).toBeGreaterThanOrEqual(1);
  });
});
