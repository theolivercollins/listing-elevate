/**
 * Tests for v1.1 version-scoped recipe promotion and retrieval.
 *
 * Lane B scope:
 *  - autoPromoteIfWinning inherits pipeline_version from the iteration row
 *    and stamps it onto the new prompt_lab_recipes row.
 *  - retrieveMatchingRecipes filters out recipes that don't match the requested
 *    pipeline_version when opts.pipelineVersion is supplied.
 *
 * All Supabase calls are mocked via vi.mock — no real network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy deps that have side effects on import ────────────────────────

vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn() }));

// Mock embeddings — autoPromoteIfWinning uses embedTextSafe when the
// iteration doesn't carry a pre-computed embedding.
vi.mock("./embeddings.js", () => ({
  embedTextSafe: vi.fn().mockResolvedValue(null),
  buildAnalysisText: vi.fn().mockReturnValue("text"),
  toPgVector: vi.fn((v: number[]) => `[${v.join(",")}]`),
  fromPgVector: vi.fn(),
}));

vi.mock("./db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
  getSupabase: vi.fn(),
}));

vi.mock("./providers/router.js", () => ({
  selectProvider: vi.fn(),
  resolveDecision: vi.fn(),
  resolveDecisionAsync: vi.fn(),
  forceSeedancePushInPrompt: vi.fn((p: string) => p),
}));

vi.mock("./providers/kling.js", () => ({
  KlingProvider: vi.fn(),
}));

vi.mock("./providers/runway.js", () => ({
  RunwayProvider: vi.fn(),
}));

vi.mock("./providers/atlas.js", () => ({
  AtlasProvider: vi.fn(),
}));

vi.mock("./providers/provider.interface.js", () => ({
  pollUntilComplete: vi.fn(),
}));

// ── Supabase mock factory ────────────────────────────────────────────────────

// We need fine-grained control over each Supabase call, so we build a
// chainable mock manually and allow individual tests to override `.single()`.

type SupabaseChain = {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

function makeChain(overrides: Partial<SupabaseChain> = {}): SupabaseChain {
  const chain: SupabaseChain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  };
  // Make fluent methods return the same chain object.
  chain.from.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.neq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  return chain;
}

// ── Import the module under test ─────────────────────────────────────────────

// Import after mocks are registered.
import { autoPromoteIfWinning, retrieveMatchingRecipes } from "./prompt-lab.js";
import { getSupabase } from "./client.js";

// client.js is imported directly by prompt-lab.ts for getSupabase().
vi.mock("./client.js", () => ({
  getSupabase: vi.fn(),
}));

const mockGetSupabase = vi.mocked(getSupabase);

// ── Fixtures ─────────────────────────────────────────────────────────────────

import type { PhotoAnalysisResult } from "./prompts/photo-analysis.js";
import type { DirectorSceneOutput } from "./prompts/director.js";

const ANALYSIS: PhotoAnalysisResult = {
  room_type: "living_room",
  quality_score: 8,
  aesthetic_score: 7,
  depth_rating: "medium",
  key_features: ["fireplace", "large windows"],
  composition: "wide angle",
  suggested_discard: false,
  discard_reason: null,
  video_viable: true,
  suggested_motion: "push_in",
  motion_rationale: "depth allows push",
};

const DIRECTOR: DirectorSceneOutput = {
  scene_number: 1,
  photo_id: "photo-abc",
  room_type: "living_room",
  camera_movement: "push_in",
  prompt: "Push slowly toward the fireplace revealing the room's depth",
  duration_seconds: 5,
  provider_preference: null,
};

const PRECOMPUTED_EMBEDDING = [0.1, 0.2, 0.3];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("autoPromoteIfWinning — pipeline_version inheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps pipeline_version='v1.1' on the recipe when iteration is v1.1", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const chain = makeChain({
      single: vi.fn().mockImplementation(async () => {
        const last = insertedRows[insertedRows.length - 1];
        return { data: { id: "recipe-111", archetype: last?.archetype ?? "arch" }, error: null };
      }),
    });

    // Intercept insert to capture the payload.
    chain.insert.mockImplementation((payload: Record<string, unknown>) => {
      insertedRows.push(payload);
      return chain;
    });

    mockGetSupabase.mockReturnValue(chain as never);

    const result = await autoPromoteIfWinning({
      iterationRow: {
        id: "iter-111",
        analysis_json: ANALYSIS,
        director_output_json: DIRECTOR,
        embedding: PRECOMPUTED_EMBEDDING,
        provider: "atlas",
        pipeline_version: "v1.1",
      },
      rating: 5,
      promotedBy: "admin-user",
    });

    expect(result).not.toBeNull();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ pipeline_version: "v1.1" });
  });

  it("stamps pipeline_version='v1' on the recipe when iteration is v1", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const chain = makeChain({
      single: vi.fn().mockImplementation(async () => {
        const last = insertedRows[insertedRows.length - 1];
        return { data: { id: "recipe-v1", archetype: last?.archetype ?? "arch" }, error: null };
      }),
    });

    chain.insert.mockImplementation((payload: Record<string, unknown>) => {
      insertedRows.push(payload);
      return chain;
    });

    mockGetSupabase.mockReturnValue(chain as never);

    const result = await autoPromoteIfWinning({
      iterationRow: {
        id: "iter-v1",
        analysis_json: ANALYSIS,
        director_output_json: DIRECTOR,
        embedding: PRECOMPUTED_EMBEDDING,
        provider: "atlas",
        pipeline_version: "v1",
      },
      rating: 5,
      promotedBy: "admin-user",
    });

    expect(result).not.toBeNull();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ pipeline_version: "v1" });
  });

  it("defaults pipeline_version to 'v1' when the field is absent (backward compat)", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const chain = makeChain({
      single: vi.fn().mockImplementation(async () => {
        const last = insertedRows[insertedRows.length - 1];
        return { data: { id: "recipe-compat", archetype: last?.archetype ?? "arch" }, error: null };
      }),
    });

    chain.insert.mockImplementation((payload: Record<string, unknown>) => {
      insertedRows.push(payload);
      return chain;
    });

    mockGetSupabase.mockReturnValue(chain as never);

    const result = await autoPromoteIfWinning({
      iterationRow: {
        id: "iter-compat",
        analysis_json: ANALYSIS,
        director_output_json: DIRECTOR,
        embedding: PRECOMPUTED_EMBEDDING,
        provider: "atlas",
        // pipeline_version deliberately omitted to exercise the default.
      },
      rating: 4,
      promotedBy: "admin-user",
    });

    expect(result).not.toBeNull();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ pipeline_version: "v1" });
  });

  it("returns null without inserting when rating < 4", async () => {
    const chain = makeChain();
    mockGetSupabase.mockReturnValue(chain as never);

    const result = await autoPromoteIfWinning({
      iterationRow: {
        id: "iter-low",
        analysis_json: ANALYSIS,
        director_output_json: DIRECTOR,
        embedding: PRECOMPUTED_EMBEDDING,
        provider: "atlas",
        pipeline_version: "v1.1",
      },
      rating: 3,
      promotedBy: "admin-user",
    });

    expect(result).toBeNull();
    expect(chain.insert).not.toHaveBeenCalled();
  });
});

describe("retrieveMatchingRecipes — pipeline_version filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only v1.1 recipes when pipelineVersion='v1.1' is requested", async () => {
    // RPC returns two recipes; one is v1.1, one is v1.
    const rpcRecipes = [
      { id: "r-v11", archetype: "arch_v11", room_type: "living_room", camera_movement: "push_in",
        provider: null, model_used: null, prompt_template: "push slowly", composition_signature: null,
        times_applied: 2, distance: 0.1 },
      { id: "r-v1", archetype: "arch_v1", room_type: "living_room", camera_movement: "orbit",
        provider: null, model_used: null, prompt_template: "orbit around", composition_signature: null,
        times_applied: 5, distance: 0.2 },
    ];

    // The follow-up SELECT to get pipeline_version for each recipe ID.
    const versionRows = [
      { id: "r-v11", pipeline_version: "v1.1" },
      { id: "r-v1", pipeline_version: "v1" },
    ];

    // We need the chain to behave differently for .rpc() vs .from().select()
    // calls. Use a call counter to distinguish them.
    let rpcCalled = false;
    const chain = makeChain();

    chain.rpc.mockImplementation(() => {
      rpcCalled = true;
      return Promise.resolve({ data: rpcRecipes, error: null });
    });

    // The second call is from("prompt_lab_recipes").select("id, pipeline_version").in(...)
    chain.in.mockImplementation(() => {
      return {
        ...chain,
        // Resolve the terminal promise with version rows.
        then: (resolve: (v: { data: typeof versionRows; error: null }) => unknown) =>
          Promise.resolve({ data: versionRows, error: null }).then(resolve),
      };
    });

    mockGetSupabase.mockReturnValue(chain as never);

    const results = await retrieveMatchingRecipes(
      [0.1, 0.2, 0.3],
      "living_room",
      { pipelineVersion: "v1.1" }
    );

    expect(rpcCalled).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("r-v11");
  });

  it("returns all RPC results unchanged when no pipelineVersion is specified", async () => {
    const rpcRecipes = [
      { id: "r-a", archetype: "arch_a", room_type: "kitchen", camera_movement: "push_in",
        provider: null, model_used: null, prompt_template: "pt1", composition_signature: null,
        times_applied: 1, distance: 0.1 },
      { id: "r-b", archetype: "arch_b", room_type: "kitchen", camera_movement: "orbit",
        provider: null, model_used: null, prompt_template: "pt2", composition_signature: null,
        times_applied: 3, distance: 0.25 },
    ];

    const chain = makeChain();
    chain.rpc.mockResolvedValue({ data: rpcRecipes, error: null });
    mockGetSupabase.mockReturnValue(chain as never);

    const results = await retrieveMatchingRecipes(
      [0.1, 0.2, 0.3],
      "kitchen",
      {} // no pipelineVersion
    );

    expect(results).toHaveLength(2);
    // The follow-up SELECT should NOT have been triggered.
    expect(chain.in).not.toHaveBeenCalled();
  });
});
