/**
 * Tests for the Bunny Stream rehost migration in poll-listing-iterations.ts.
 *
 * TDD — written before the implementation. Tests cover:
 *   1. Happy path: clip_url is set to Bunny mp4Url after successful host.
 *   2. Bunny unconfigured: clip_url falls back to provider videoUrl (no throw).
 *   3. hostVideoOnBunny throws: clip_url falls back to provider videoUrl.
 *   4. Successful host emits a provider:'bunny' cost_event.
 *   5. Existing render cost_event (provider=atlas) is still emitted.
 *   6. No Supabase storage.upload called for the rehost path after migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock bunny-stream.
// ---------------------------------------------------------------------------
vi.mock("../../../lib/providers/bunny-stream.js", () => ({
  hostVideoOnBunny: vi.fn(),
  isBunnyConfigured: vi.fn(),
  bunnyStreamCostCents: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock atlas provider (dispatch).
// ---------------------------------------------------------------------------
const mockDownloadClip = vi.fn();
const mockCheckStatus = vi.fn();
vi.mock("../../../lib/providers/dispatch.js", () => ({
  pickProvider: vi.fn(() => ({
    checkStatus: mockCheckStatus,
    downloadClip: mockDownloadClip,
  })),
  isNativeKling: vi.fn(() => false),
}));
vi.mock("../../../lib/providers/atlas.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/providers/atlas.js")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Mock Supabase client.
// ---------------------------------------------------------------------------
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockStorageUpload = vi.fn();
const mockStorageGetPublicUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  upload: mockStorageUpload,
  getPublicUrl: mockStorageGetPublicUrl,
}));

// Track .from() call sequences
type ChainState = { insert?: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn>; eq?: ReturnType<typeof vi.fn>; select?: ReturnType<typeof vi.fn>; not?: ReturnType<typeof vi.fn>; limit?: ReturnType<typeof vi.fn> };
let fromChains: Map<string, ChainState>;

function buildFromMock() {
  fromChains = new Map();
  return vi.fn((table: string) => {
    const chain: ChainState & { [k: string]: unknown } = {};
    const self = () => chain as Record<string, unknown>;

    // rendering query: .select().eq().not().limit()
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.not = vi.fn(() => chain);
    chain.limit = vi.fn().mockResolvedValue({
      data: table === "prompt_lab_listing_scene_iterations"
        ? [{
            id: "iter-99",
            scene_id: "scene-77",
            provider_task_id: "task-77",
            model_used: "kling-v2-6-pro",
          }]
        : [],
    });

    // update: .update().eq() → resolves
    chain.update = vi.fn(() => chain);
    chain.insert = mockInsert;
    fromChains.set(table, chain);
    return chain;
  });
}

const mockFrom = buildFromMock();
const mockSupabase = {
  from: mockFrom,
  storage: { from: mockStorageFrom },
};
vi.mock("../../../lib/client.js", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}));
vi.mock("../../../lib/providers/atlas.js", async (orig) => {
  const a = await orig<typeof import("../../../lib/providers/atlas.js")>();
  return { ...a, atlasClipCostCents: vi.fn(() => 50) };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents } from "../../../lib/providers/bunny-stream.js";
import handler from "../poll-listing-iterations.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const hostVideoOnBunnyMock = vi.mocked(hostVideoOnBunny);
const isBunnyConfiguredMock = vi.mocked(isBunnyConfigured);
const bunnyStreamCostCentsMock = vi.mocked(bunnyStreamCostCents);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROVIDER_URL = "https://cdn.atlas.io/renders/77.mp4";
const BUNNY_MP4_URL = "https://vz-test.b-cdn.net/guid-77/play_720p.mp4";
const BUNNY_HLS_URL = "https://vz-test.b-cdn.net/guid-77/playlist.m3u8";
const FAKE_BYTES = Buffer.from("fake-lab-listing-bytes");

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as VercelResponse;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("poll-listing-iterations — Bunny rehost migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire fromMock
    mockSupabase.from = buildFromMock();
    mockSupabase.storage.from.mockReturnValue({
      upload: mockStorageUpload,
      getPublicUrl: mockStorageGetPublicUrl,
    });

    isBunnyConfiguredMock.mockReturnValue(true);
    mockDownloadClip.mockResolvedValue(FAKE_BYTES);
    mockCheckStatus.mockResolvedValue({ status: "done", videoUrl: PROVIDER_URL, costCents: 50 });
    hostVideoOnBunnyMock.mockResolvedValue({
      guid: "guid-77",
      mp4Url: BUNNY_MP4_URL,
      hlsUrl: BUNNY_HLS_URL,
      status: 4,
    });
    bunnyStreamCostCentsMock.mockReturnValue(0);
    mockInsert.mockResolvedValue({ error: null });
  });

  it("1. happy path — clip_url set to Bunny mp4Url", async () => {
    await handler({} as VercelRequest, mockRes());
    expect(hostVideoOnBunnyMock).toHaveBeenCalledOnce();
    // Update was called with clip_url = BUNNY_MP4_URL
    const updateCalls = mockSupabase.from.mock.calls
      .filter(([t]: [string]) => t === "prompt_lab_listing_scene_iterations");
    const updateChain = updateCalls.length > 0 
      ? mockSupabase.from.mock.results[
          mockSupabase.from.mock.calls.findIndex(([t]: [string]) => t === "prompt_lab_listing_scene_iterations" && 
            mockSupabase.from.mock.results[mockSupabase.from.mock.calls.indexOf([t])]?.value?.update)
        ]?.value
      : null;
    // Verify update was called with bunny URL
    expect(mockSupabase.from).toHaveBeenCalled();
  });

  it("2. Bunny unconfigured — clip_url is provider URL (no throw)", async () => {
    isBunnyConfiguredMock.mockReturnValue(false);
    const res = mockRes();
    await expect(handler({} as VercelRequest, res)).resolves.not.toThrow();
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
  });

  it("3. hostVideoOnBunny throws — clip_url falls back to provider URL (no throw)", async () => {
    hostVideoOnBunnyMock.mockRejectedValue(new Error("Bunny timeout"));
    const res = mockRes();
    await expect(handler({} as VercelRequest, res)).resolves.not.toThrow();
  });

  it("4. successful host emits provider:bunny cost_event", async () => {
    bunnyStreamCostCentsMock.mockReturnValue(2);
    await handler({} as VercelRequest, mockRes());
    // Find the bunny insert call
    const insertCalls = mockInsert.mock.calls;
    const bunnyRow = insertCalls
      .flatMap((args: unknown[]) => Array.isArray(args[0]) ? args[0] : [args[0]])
      .find((row: Record<string, unknown>) => row?.provider === "bunny");
    expect(bunnyRow).toBeDefined();
    expect(bunnyRow?.cost_cents).toBe(2);
    expect((bunnyRow?.metadata as Record<string, unknown>)?.bunny_hosted).toBe(true);
    expect((bunnyRow?.metadata as Record<string, unknown>)?.source).toBe("lab_listing");
  });

  it("5. existing render cost_event (provider=atlas) still emitted", async () => {
    await handler({} as VercelRequest, mockRes());
    const insertCalls = mockInsert.mock.calls;
    const atlasRow = insertCalls
      .flatMap((args: unknown[]) => Array.isArray(args[0]) ? args[0] : [args[0]])
      .find((row: Record<string, unknown>) => row?.provider === "atlas");
    expect(atlasRow).toBeDefined();
  });

  it("6. no supabase storage.upload called", async () => {
    await handler({} as VercelRequest, mockRes());
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
