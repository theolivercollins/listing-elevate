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
});
