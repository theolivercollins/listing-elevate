/**
 * Tests for rerunAssembly (Task 9 — Operator Studio Phase 1)
 *
 * Strategy: mock lib/db.js and the assembly-router dynamic import so we can
 * exercise the guard logic and the reason flag without hitting real providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mutable state for db mock (avoids closure-before-init) ──────────
//
// vitest hoists vi.mock factories to the top of the file, before any `const`
// bindings. We work around this by using module-level vi.fn() references that
// the factory closes over via the outer vi.fn() assignment path, with
// mockImplementation overrides in beforeEach.

vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn() }));

vi.mock("../providers/gemini-analyzer.js", () => ({
  analyzePhotoWithGemini: vi.fn(),
}));

vi.mock("../prompts/per-photo-retrieval.js", () => ({
  fetchPerPhotoRetrievalBundle: vi.fn(),
  renderPerPhotoBlock: vi.fn(),
}));

vi.mock("../prompts/resolve.js", () => ({
  resolveProductionPrompt: vi.fn(),
}));

vi.mock("../prompts/rewrite-on-motion-override.js", () => ({
  rewritePromptForNewMotion: vi.fn(),
}));

vi.mock("../services/end-frame.js", () => ({
  resolveEndFrameUrl: vi.fn(),
}));

vi.mock("../providers/router.js", () => ({
  selectProviderForScene: vi.fn(),
  buildProviderFromDecision: vi.fn(),
  getEnabledProviders: vi.fn().mockReturnValue([]),
}));

vi.mock("../providers/provider.interface.js", () => ({
  pollUntilComplete: vi.fn(),
}));

vi.mock("../providers/errors.js", () => ({
  classifyProviderError: vi.fn(),
}));

vi.mock("../pipeline/selection.js", () => ({
  selectPhotos: vi.fn().mockReturnValue([]),
  TARGET_SCENE_COUNT: 12,
  MAX_PER_ROOM_TYPE: 3,
  REQUIRED_ROOM_TYPES: [],
}));

vi.mock("../prompt-lab-listings.js", () => ({
  mapCameraMovementToHeadroomKey: vi.fn(),
}));

vi.mock("../assembly/branding.js", () => ({
  fetchPropertyBranding: vi.fn().mockResolvedValue({
    brokerageName: null,
    logoUrl: null,
    primaryColor: "#000000",
    secondaryColor: "#ffffff",
    phone: null,
  }),
}));

vi.mock("../assembly/music.js", () => ({
  selectMusicTrackForProperty: vi.fn().mockResolvedValue(null),
}));

vi.mock("../assembly/template-resolver.js", () => ({
  resolveTemplateId: vi.fn().mockReturnValue(null),
}));

vi.mock("../assembly/template-modifications.js", () => ({
  buildTemplateModifications: vi.fn().mockReturnValue({}),
}));

vi.mock("../assembly/scene-ordering.js", () => ({
  orderScenesForAssembly: vi.fn().mockImplementation((s: unknown[]) => s),
}));

vi.mock("../assembly/duration-fit.js", () => ({
  fitScenesToDuration: vi.fn().mockImplementation(
    (scenes: Array<{ durationSeconds?: number; duration_seconds?: number }>) =>
      scenes.map((s) => ({
        scene: s,
        durationSeconds: s.durationSeconds ?? s.duration_seconds ?? 5,
      })),
  ),
}));

vi.mock("../operator-studio/brand-kit.js", () => ({
  brandKitFromClient: vi.fn().mockReturnValue({}),
  mergeBrandVars: vi.fn().mockImplementation((mods: unknown) => mods),
  applyRealtorSuffix: vi.fn().mockImplementation((name: unknown) => name),
}));

vi.mock("../providers/assembly-router.js", () => ({
  selectAssemblyProvider: vi.fn().mockReturnValue({
    name: "shotstack",
    assemble: vi.fn().mockResolvedValue({ jobId: "h-job-1" }),
    assembleFromTemplate: vi.fn().mockResolvedValue({ jobId: "h-job-1" }),
  }),
  pollAssemblyJob: vi.fn().mockResolvedValue({
    status: "complete",
    videoUrl: "https://cdn.example.com/h.mp4",
    durationSeconds: 30,
    renderTimeMs: 5000,
  }),
  assemblyProviderCostCents: vi.fn().mockReturnValue(50),
}));

// Finalize — mocked so tests never make a real network call. Default mirrors
// the real function's fallback shape (download/host skipped or failed):
// url passes the provider URL through unchanged, hlsUrl/posterUrl stay null.
// Migration-102 (hls/poster) tests below override this per-call via
// mockImplementationOnce to exercise runAssemblyStep's persist wiring.
vi.mock("../assembly/finalize.js", () => ({
  finalizeAssemblyRender: vi.fn().mockImplementation(async (params: { providerUrl: string }) => ({
    url: params.providerUrl,
    bitrateKbps: null,
    outputBytes: null,
    bunnyWasCalled: false,
    hlsUrl: null,
    posterUrl: null,
  })),
}));

// db.js mock — all factories use plain vi.fn() to avoid hoisting issues.
vi.mock("../db.js", () => ({
  getSupabase: vi.fn(),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
  getProperty: vi.fn(),
  getScenesForProperty: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  getPhotosForProperty: vi.fn(),
  updatePhotoAnalysis: vi.fn(),
  getSelectedPhotos: vi.fn(),
  insertScenes: vi.fn(),
  embedScene: vi.fn(),
  updateSceneStatus: vi.fn(),
  updateScene: vi.fn(),
  addPropertyCost: vi.fn(),
  recordPromptRevisionIfChanged: vi.fn(),
}));

// Import mocked modules AFTER vi.mock calls.
import * as db from "../db.js";
import { rerunAssembly } from "../pipeline.js";
import * as assemblyRouter from "../providers/assembly-router.js";
import { finalizeAssemblyRender } from "../assembly/finalize.js";

// ── Fixture data ───────────────────────────────────────────────────────────

const PROP_COMPLETE = {
  id: "prop-1",
  status: "complete",
  address: "123 Main St",
  price: 500000,
  bedrooms: 3,
  bathrooms: 2,
  listing_agent: "Jane Doe",
  brokerage: "Acme Realty",
  selected_package: "just_listed",
  selected_duration: 30,
  created_at: new Date().toISOString(),
  pipeline_started_at: new Date().toISOString(),
  total_cost_cents: 0,
  client_id: null,
  template_id: null,
};

const PROP_GENERATING = { ...PROP_COMPLETE, id: "prop-2", status: "generating" };

const QC_SCENE = {
  id: "scene-1",
  status: "qc_pass",
  clip_url: "https://cdn.example.com/clip1.mp4",
  scene_number: 1,
  photo_id: "photo-1",
  camera_movement: "push_in",
  prompt: "slow push in",
  duration_seconds: 5,
  provider: "kling",
  provider_task_id: "task-1",
  end_photo_id: null,
  end_image_url: null,
  room_type: "living_room",
};

// ── Helper to build a minimal Supabase chainable mock ─────────────────────

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  const resolve = vi.fn().mockResolvedValue({ data, error: null });
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = resolve;
  chain.single = resolve;
  chain.then = undefined;
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("rerunAssembly", () => {
  afterEach(() => {
    delete process.env.SHOTSTACK_API_KEY;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Enable the assembly path so recordCostEvent is called and we can
    // verify the reason flag is threaded through. Without a key the code
    // short-circuits to "no assembly provider configured" and skips renders.
    process.env.SHOTSTACK_API_KEY = "test-key";

    // Reset log + status mocks (cleared by clearAllMocks).
    vi.mocked(db.log).mockResolvedValue(undefined);
    vi.mocked(db.updatePropertyStatus).mockResolvedValue(undefined);
    vi.mocked(db.recordCostEvent).mockResolvedValue(undefined);
    vi.mocked(db.getProperty).mockResolvedValue(PROP_COMPLETE as never);
    vi.mocked(db.getScenesForProperty).mockResolvedValue([QC_SCENE] as never);

    // Default: property is complete, supabase returns PROP_COMPLETE.
    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") {
          return makeChain({ id: "photo-1", room_type: "living_room" });
        }
        if (table === "delivery_runs") {
          // Customer flow: no delivery run -> deterministic order untouched.
          return makeChain(null);
        }
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    // Reset assembly router mocks.
    const mockAssemble = vi.fn().mockResolvedValue({ jobId: "h-job-1" });
    vi.mocked(assemblyRouter.selectAssemblyProvider).mockReturnValue({
      name: "shotstack",
      assemble: mockAssemble,
      assembleFromTemplate: vi.fn().mockResolvedValue({ jobId: "h-job-1" }),
    } as never);
    vi.mocked(assemblyRouter.pollAssemblyJob).mockResolvedValue({
      status: "complete",
      videoUrl: "https://cdn.example.com/h.mp4",
      durationSeconds: 30,
      renderTimeMs: 5000,
    } as never);
    vi.mocked(assemblyRouter.assemblyProviderCostCents).mockReturnValue(50);
  });

  it("throws 'Cannot rerun assembly while pipeline is in generating'", async () => {
    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue(makeChain(PROP_GENERATING)),
    } as never);

    await expect(rerunAssembly("prop-2")).rejects.toThrow(
      "Cannot rerun assembly while pipeline is in generating",
    );

    // Guard short-circuits before touching status or assembly.
    expect(db.updatePropertyStatus).not.toHaveBeenCalled();
  });

  it("throws 'No completed scenes — nothing to assemble'", async () => {
    // Scene exists but has no clip_url and status is not qc_pass.
    vi.mocked(db.getScenesForProperty).mockResolvedValue([
      { ...QC_SCENE, status: "generating", clip_url: null },
    ] as never);

    await expect(rerunAssembly("prop-1")).rejects.toThrow(
      "No completed scenes — nothing to assemble",
    );

    expect(db.updatePropertyStatus).not.toHaveBeenCalled();
  });

  // ── Strengthened completeness guard (2026-07-01 incident — delivery run
  //    4b15ef63 assembled a 30s video from only 3 of 7 scenes and marked the
  //    property complete, because this guard only checked
  //    `completedScenes.length === 0`). Two independent floors now apply:
  //      (a) no runId (legacy / clip-swap path) → the qc_pass count
  //          (clip-agnostic, mirroring the poll-scenes admitting gate — a
  //          skipped scene is qc_pass with clip_url=null) must clear
  //          passingThreshold(totalScenes) = ceil(total * 0.8), AND at least
  //          one clip-bearing scene must exist.
  //      (b) runId given AND that run has a non-empty scene_order → EVERY
  //          scene id in the order must be qc_pass with a clip_url.

  function makeScene(overrides: Partial<typeof QC_SCENE> & { id: string }) {
    return { ...QC_SCENE, ...overrides };
  }

  it("legacy path (no runId): regression — 6 of 7 scenes qc_pass still assembles", async () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      n === 7
        ? makeScene({ id: `scene-${n}`, scene_number: n, status: "needs_review", clip_url: null })
        : makeScene({ id: `scene-${n}`, scene_number: n }),
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    await expect(rerunAssembly("prop-1")).resolves.toBeUndefined();
    expect(db.updatePropertyStatus).toHaveBeenCalledWith("prop-1", "assembling");
  });

  it("legacy path (no runId): operator-skipped scenes (qc_pass, clip_url=null) count toward the 80% floor — clip-swap re-assembly with 2 of 7 skipped still assembles", async () => {
    // api/scenes/[id]/skip.ts marks a skipped scene status:'qc_pass' with
    // clip_url:null. The threshold comparison must mirror the poll-scenes
    // admitting gate (clip-agnostic qc_pass count) — otherwise >20% skipped
    // scenes would reject a legitimate clip-swap rerun. Here: 5 clip-bearing
    // + 2 skipped = 7 qc_pass ≥ passingThreshold(7)=6, even though only 5
    // scenes carry clips.
    const scenes = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      n >= 6
        ? makeScene({ id: `scene-${n}`, scene_number: n, clip_url: null }) // skipped: qc_pass, no clip
        : makeScene({ id: `scene-${n}`, scene_number: n }),
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    await expect(rerunAssembly("prop-1")).resolves.toBeUndefined();
    expect(db.updatePropertyStatus).toHaveBeenCalledWith("prop-1", "assembling");
  });

  it("legacy path (no runId): still throws when ALL qc_pass scenes are skipped (zero clips — nothing to assemble)", async () => {
    const scenes = [1, 2, 3].map((n) =>
      makeScene({ id: `scene-${n}`, scene_number: n, clip_url: null }), // all skipped
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    await expect(rerunAssembly("prop-1")).rejects.toThrow(
      "No completed scenes — nothing to assemble",
    );
    expect(db.updatePropertyStatus).not.toHaveBeenCalled();
  });

  it("legacy path (no runId): throws when completed scenes fall below the 80% floor (the incident's 3 of 7)", async () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      n <= 3
        ? makeScene({ id: `scene-${n}`, scene_number: n })
        : makeScene({ id: `scene-${n}`, scene_number: n, status: "generating", clip_url: null }),
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    await expect(rerunAssembly("prop-1")).rejects.toThrow(
      "Insufficient completed scenes: 3 of 7 (need at least 6) — nothing to assemble",
    );
    expect(db.updatePropertyStatus).not.toHaveBeenCalled();
  });

  it("delivery-run path (runId given): throws when a scene in scene_order is not qc_pass with a clip", async () => {
    const scenes = [
      makeScene({ id: "scene-1", scene_number: 1 }),
      makeScene({ id: "scene-2", scene_number: 2, status: "needs_review", clip_url: null }),
      makeScene({ id: "scene-3", scene_number: 3 }),
    ];
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") return makeChain({ id: "photo-1", room_type: "living_room" });
        if (table === "delivery_runs") {
          return makeChain({ scene_order: ["scene-1", "scene-2", "scene-3"] });
        }
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    await expect(rerunAssembly("prop-1", { runId: "run-1" })).rejects.toThrow(
      "Cannot assemble: 1 of 3 scenes in the delivery run's scene_order are not qc_pass with a clip (scene ids scene-2)",
    );
    expect(db.updatePropertyStatus).not.toHaveBeenCalled();
  });

  it("delivery-run path (runId given): assembles when every scene in scene_order is qc_pass with a clip", async () => {
    const scenes = [
      makeScene({ id: "scene-1", scene_number: 1 }),
      makeScene({ id: "scene-2", scene_number: 2 }),
    ];
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") return makeChain({ id: "photo-1", room_type: "living_room" });
        if (table === "delivery_runs") return makeChain({ scene_order: ["scene-1", "scene-2"] });
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    await expect(rerunAssembly("prop-1", { runId: "run-1" })).resolves.toBeUndefined();
    expect(db.updatePropertyStatus).toHaveBeenCalledWith("prop-1", "assembling");
  });

  it("delivery-run path (runId given, scene_order null/empty): falls back to the passingThreshold floor", async () => {
    const scenes = [1, 2, 3].map((n) =>
      n === 3
        ? makeScene({ id: `scene-${n}`, scene_number: n, status: "generating", clip_url: null })
        : makeScene({ id: `scene-${n}`, scene_number: n }),
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") return makeChain({ id: "photo-1", room_type: "living_room" });
        if (table === "delivery_runs") return makeChain({ scene_order: null });
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    // passingThreshold(3) = ceil(3*0.8) = 3; only 2 of 3 are qc_pass → throws.
    await expect(rerunAssembly("prop-1", { runId: "run-1" })).rejects.toThrow(
      "Insufficient completed scenes: 2 of 3 (need at least 3) — nothing to assemble",
    );
  });

  it("allowPartial:true opts out of the strengthened guard (only the bare >0 floor applies)", async () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      n === 1
        ? makeScene({ id: `scene-${n}`, scene_number: n })
        : makeScene({ id: `scene-${n}`, scene_number: n, status: "generating", clip_url: null }),
    );
    vi.mocked(db.getScenesForProperty).mockResolvedValue(scenes as never);

    // Even with a runId + full scene_order that would otherwise fail the
    // strict per-scene check, allowPartial bypasses it entirely.
    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") return makeChain({ id: "photo-1", room_type: "living_room" });
        if (table === "delivery_runs") {
          return makeChain({ scene_order: scenes.map((s) => s.id) });
        }
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    await expect(
      rerunAssembly("prop-1", { runId: "run-1", allowPartial: true }),
    ).resolves.toBeUndefined();
    expect(db.updatePropertyStatus).toHaveBeenCalledWith("prop-1", "assembling");
  });

  it("sets status to assembling and records cost_events with reason=manual_rerun", async () => {
    await rerunAssembly("prop-1");

    // Status set to assembling before assembly step runs.
    expect(db.updatePropertyStatus).toHaveBeenCalledWith("prop-1", "assembling");

    // At least one cost event should carry reason='manual_rerun'.
    const costCalls = vi.mocked(db.recordCostEvent).mock.calls as Array<
      [{ metadata?: Record<string, unknown> }]
    >;
    const hasManualRerun = costCalls.some(
      ([event]) => event.metadata?.reason === "manual_rerun",
    );
    expect(hasManualRerun).toBe(true);
  });

  // ── Orientation gating (Fix 1 — honor properties.selected_orientation) ──
  //
  // The shotstack provider path has no creatomate skipVertical short-circuit,
  // so the only thing keeping a render from firing is the orientation gate.
  // We assert via the aspect_ratio on each recorded cost_event + the
  // horizontal_video_url / vertical_video_url written by updatePropertyStatus.

  function aspectRatiosRendered(): string[] {
    const costCalls = vi.mocked(db.recordCostEvent).mock.calls as Array<
      [{ metadata?: Record<string, unknown> }]
    >;
    return costCalls
      .map(([e]) => e.metadata?.aspect_ratio)
      .filter((a): a is string => typeof a === "string");
  }

  function finalStatusPatch(): Record<string, unknown> {
    const calls = vi.mocked(db.updatePropertyStatus).mock.calls as Array<
      [string, string, Record<string, unknown>?]
    >;
    const complete = calls.find(([, status]) => status === "complete");
    return (complete?.[2] ?? {}) as Record<string, unknown>;
  }

  it("orientation null defaults to horizontal-only (no 9:16 render)", async () => {
    vi.mocked(db.getProperty).mockResolvedValue({
      ...PROP_COMPLETE,
      selected_orientation: null,
    } as never);

    await rerunAssembly("prop-1");

    expect(aspectRatiosRendered()).toEqual(["16:9"]);
    const patch = finalStatusPatch();
    expect(patch.horizontal_video_url).toBe("https://cdn.example.com/h.mp4");
    expect(patch.vertical_video_url).toBeUndefined();
  });

  it("orientation 'horizontal' renders 16:9 only", async () => {
    vi.mocked(db.getProperty).mockResolvedValue({
      ...PROP_COMPLETE,
      selected_orientation: "horizontal",
    } as never);

    await rerunAssembly("prop-1");

    expect(aspectRatiosRendered()).toEqual(["16:9"]);
    expect(finalStatusPatch().vertical_video_url).toBeUndefined();
  });

  it("orientation 'both' renders 16:9 and 9:16", async () => {
    vi.mocked(db.getProperty).mockResolvedValue({
      ...PROP_COMPLETE,
      selected_orientation: "both",
    } as never);

    await rerunAssembly("prop-1");

    expect(aspectRatiosRendered()).toEqual(["16:9", "9:16"]);
    const patch = finalStatusPatch();
    expect(patch.horizontal_video_url).toBe("https://cdn.example.com/h.mp4");
    expect(patch.vertical_video_url).toBe("https://cdn.example.com/h.mp4");
  });

  it("orientation 'vertical' renders 9:16 only and leaves horizontal_video_url null", async () => {
    vi.mocked(db.getProperty).mockResolvedValue({
      ...PROP_COMPLETE,
      selected_orientation: "vertical",
    } as never);

    await rerunAssembly("prop-1");

    expect(aspectRatiosRendered()).toEqual(["9:16"]);
    const patch = finalStatusPatch();
    expect(patch.horizontal_video_url).toBeUndefined();
    expect(patch.vertical_video_url).toBe("https://cdn.example.com/h.mp4");
  });

  // ── Delivery-run scene-order lookup (Fix 5 — active run with null order) ──
  //
  // Edge: active run has scene_order=null while an older delivered run has a
  // curated order.  The lookup must fall through to the delivered run's order
  // rather than silently using the walkthrough default.

  it("falls through to delivered-run order when active run has null scene_order", async () => {
    const curatedOrder = ["scene-1"];

    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") {
          return makeChain({ id: "photo-1", room_type: "living_room" });
        }
        if (table === "delivery_runs") {
          // Build a chain that handles both the maybeSingle (active run)
          // and the array (any-run) queries.
          let limitCount = 0;
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.neq = vi.fn().mockReturnValue(chain);
          chain.order = vi.fn().mockReturnValue(chain);
          chain.limit = vi.fn().mockImplementation((n: number) => {
            limitCount = n;
            return chain;
          });
          chain.maybeSingle = vi.fn().mockResolvedValue({
            // Active run: exists but no scene_order.
            data: { scene_order: null },
            error: null,
          });
          // Array query (limit > 1) returns one delivered run with a curated order.
          chain.then = vi.fn().mockImplementation((resolve: (v: { data: unknown; error: null }) => unknown) => {
            const rows = limitCount > 1
              ? [{ scene_order: curatedOrder }]
              : [{ scene_order: null }];
            return Promise.resolve(resolve({ data: rows, error: null }));
          });
          return chain;
        }
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    await rerunAssembly("prop-1");

    // applySceneOrder is called inside a dynamic import; verify via the log
    // call that confirms the operator order was applied.
    const logCalls = vi.mocked(db.log).mock.calls as Array<
      [string, string, string, string, unknown]
    >;
    const usedOperatorOrder = logCalls.some(
      ([, , , msg]) => typeof msg === "string" && msg.includes("operator delivery scene order"),
    );
    expect(usedOperatorOrder).toBe(true);
  });

  it("uses active run scene_order when present (non-empty)", async () => {
    const activeOrder = ["scene-1"];

    vi.mocked(db.getSupabase).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "photos") {
          return makeChain({ id: "photo-1", room_type: "living_room" });
        }
        if (table === "delivery_runs") {
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.neq = vi.fn().mockReturnValue(chain);
          chain.order = vi.fn().mockReturnValue(chain);
          chain.limit = vi.fn().mockReturnValue(chain);
          chain.maybeSingle = vi.fn().mockResolvedValue({
            // Active run has a curated order — should be used directly.
            data: { scene_order: activeOrder },
            error: null,
          });
          return chain;
        }
        return makeChain(PROP_COMPLETE);
      }),
    } as never);

    await rerunAssembly("prop-1");

    const logCalls = vi.mocked(db.log).mock.calls as Array<
      [string, string, string, string, unknown]
    >;
    const usedOperatorOrder = logCalls.some(
      ([, , , msg]) => typeof msg === "string" && msg.includes("operator delivery scene order"),
    );
    expect(usedOperatorOrder).toBe(true);
  });

  // ── Bunny HLS + poster persist wiring (migration 102) ─────────────────────
  //
  // finalizeAssemblyRender returns hlsUrl/posterUrl only on the fully-successful
  // Bunny host path (null on every fallback — see lib/assembly/finalize.ts).
  // mp4 + hls + poster describe ONE encode and move together: whenever an
  // orientation's mp4 is written, runAssemblyStep writes its hls/poster too —
  // null when this render produced none. An un-rendered orientation is left
  // untouched (its keys absent). finalStatusPatch() below reads exactly that
  // "complete" patch. These tests drive the real pipeline.ts code path
  // (rerunAssembly -> runAssemblyStep) with a mocked finalizeAssemblyRender.

  describe("hls/poster persist wiring (migration 102)", () => {
    it("sets horizontal_hls_url + horizontal_poster_url when finalize returns them (horizontal-only order)", async () => {
      vi.mocked(db.getProperty).mockResolvedValue({
        ...PROP_COMPLETE,
        selected_orientation: "horizontal",
      } as never);
      vi.mocked(finalizeAssemblyRender).mockImplementationOnce(async (params: { providerUrl: string }) => ({
        url: params.providerUrl,
        bitrateKbps: 9500,
        outputBytes: 50_000_000,
        bunnyWasCalled: true,
        hlsUrl: "https://cdn.example.com/h.m3u8",
        posterUrl: "https://cdn.example.com/h-poster.jpg",
      }));

      await rerunAssembly("prop-1");

      const patch = finalStatusPatch();
      expect(patch.horizontal_hls_url).toBe("https://cdn.example.com/h.m3u8");
      expect(patch.horizontal_poster_url).toBe("https://cdn.example.com/h-poster.jpg");
      // Vertical wasn't rendered — its columns must be entirely absent, not null.
      expect(patch.vertical_hls_url).toBeUndefined();
      expect(patch.vertical_poster_url).toBeUndefined();
    });

    it("clears horizontal_hls_url/horizontal_poster_url to null when finalize falls back (hlsUrl/posterUrl null)", async () => {
      vi.mocked(db.getProperty).mockResolvedValue({
        ...PROP_COMPLETE,
        selected_orientation: "horizontal",
      } as never);
      vi.mocked(finalizeAssemblyRender).mockImplementationOnce(async (params: { providerUrl: string }) => ({
        url: params.providerUrl,
        bitrateKbps: null,
        outputBytes: null,
        bunnyWasCalled: false,
        hlsUrl: null,
        posterUrl: null,
      }));

      await rerunAssembly("prop-1");

      const patch = finalStatusPatch();
      // mp4 + hls + poster are ONE coupled encode. This fallback re-render writes a
      // new mp4 with no HLS, so hls/poster MUST be cleared to null in the same
      // patch — never omitted. Omitting them would let a stale *_hls_url from a
      // previous successful render survive, and the player would serve the OLD
      // video (the bug this coupling fixes).
      expect(patch.horizontal_video_url).toBe("https://cdn.example.com/h.mp4");
      expect(patch.horizontal_hls_url).toBeNull();
      expect(patch.horizontal_poster_url).toBeNull();
    });

    it("sets vertical_hls_url + vertical_poster_url when finalize returns them (vertical-only order)", async () => {
      vi.mocked(db.getProperty).mockResolvedValue({
        ...PROP_COMPLETE,
        selected_orientation: "vertical",
      } as never);
      vi.mocked(finalizeAssemblyRender).mockImplementationOnce(async (params: { providerUrl: string }) => ({
        url: params.providerUrl,
        bitrateKbps: 5200,
        outputBytes: 30_000_000,
        bunnyWasCalled: true,
        hlsUrl: "https://cdn.example.com/v.m3u8",
        posterUrl: "https://cdn.example.com/v-poster.jpg",
      }));

      await rerunAssembly("prop-1");

      const patch = finalStatusPatch();
      expect(patch.vertical_hls_url).toBe("https://cdn.example.com/v.m3u8");
      expect(patch.vertical_poster_url).toBe("https://cdn.example.com/v-poster.jpg");
      expect(patch.horizontal_hls_url).toBeUndefined();
      expect(patch.horizontal_poster_url).toBeUndefined();
    });

    it("sets BOTH orientations' hls/poster independently when order is 'both'", async () => {
      vi.mocked(db.getProperty).mockResolvedValue({
        ...PROP_COMPLETE,
        selected_orientation: "both",
      } as never);
      // Horizontal renders first, vertical second — matches runAssemblyStep's
      // sequential (not parallel) await order.
      vi.mocked(finalizeAssemblyRender)
        .mockImplementationOnce(async (params: { providerUrl: string }) => ({
          url: params.providerUrl,
          bitrateKbps: 9500,
          outputBytes: 50_000_000,
          bunnyWasCalled: true,
          hlsUrl: "https://cdn.example.com/h.m3u8",
          posterUrl: "https://cdn.example.com/h-poster.jpg",
        }))
        .mockImplementationOnce(async (params: { providerUrl: string }) => ({
          url: params.providerUrl,
          bitrateKbps: 5200,
          outputBytes: 30_000_000,
          bunnyWasCalled: true,
          hlsUrl: "https://cdn.example.com/v.m3u8",
          posterUrl: "https://cdn.example.com/v-poster.jpg",
        }));

      await rerunAssembly("prop-1");

      const patch = finalStatusPatch();
      expect(patch.horizontal_hls_url).toBe("https://cdn.example.com/h.m3u8");
      expect(patch.horizontal_poster_url).toBe("https://cdn.example.com/h-poster.jpg");
      expect(patch.vertical_hls_url).toBe("https://cdn.example.com/v.m3u8");
      expect(patch.vertical_poster_url).toBe("https://cdn.example.com/v-poster.jpg");
    });
  });
});
