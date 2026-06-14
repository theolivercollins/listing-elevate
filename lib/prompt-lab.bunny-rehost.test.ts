/**
 * Tests for the Bunny Stream rehost migration in finalizeLabRender (lib/prompt-lab.ts).
 *
 * TDD — written before the implementation. Tests cover:
 *   1. Happy path: finalizeLabRender sets clipUrl to Bunny mp4Url on success.
 *   2. Bunny unconfigured: clipUrl falls back to provider videoUrl (no throw).
 *   3. Bunny failure (hostVideoOnBunny throws): clipUrl falls back to provider URL.
 *   4. Successful Bunny host emits a provider:'bunny' cost_event.
 *   5. Existing render cost_event (provider=atlas) is still emitted unchanged.
 *   6. No Supabase storage.upload is called for the rehost path after migration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock bunny-stream — hoisted before module graph.
// ---------------------------------------------------------------------------
vi.mock("./providers/bunny-stream.js", () => ({
  hostVideoOnBunny: vi.fn(),
  isBunnyConfigured: vi.fn(),
  bunnyStreamCostCents: vi.fn(),
  deleteBunnyVideo: vi.fn().mockResolvedValue(undefined),
  validateBunnyMp4Url: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock recordCostEvent — capture calls without real DB.
// ---------------------------------------------------------------------------
vi.mock("./db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock client.js (getSupabase).
// ---------------------------------------------------------------------------
const mockSupabaseStorage = {
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
};
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
};
const mockFrom = vi.fn(() => mockChain);
const mockSupabase = {
  from: mockFrom,
  storage: { from: vi.fn(() => mockSupabaseStorage) },
};
vi.mock("./client.js", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}));

// ---------------------------------------------------------------------------
// Mock Atlas/other providers — no real HTTP.
// ---------------------------------------------------------------------------
const mockDownloadClip = vi.fn();
const mockCheckStatus = vi.fn();
vi.mock("./providers/atlas.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/atlas.js")>();
  class MockAtlasProvider {
    name = "atlas" as const;
    async checkStatus() { return mockCheckStatus(); }
    async downloadClip() { return mockDownloadClip(); }
  }
  return { ...actual, AtlasProvider: MockAtlasProvider };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, validateBunnyMp4Url } from "./providers/bunny-stream.js";
import { recordCostEvent } from "./db.js";
import { finalizeLabRender } from "./prompt-lab.js";

const hostVideoOnBunnyMock = vi.mocked(hostVideoOnBunny);
const isBunnyConfiguredMock = vi.mocked(isBunnyConfigured);
const bunnyStreamCostCentsMock = vi.mocked(bunnyStreamCostCents);
const validateBunnyMp4UrlMock = vi.mocked(validateBunnyMp4Url);
const recordCostEventMock = vi.mocked(recordCostEvent);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROVIDER_URL = "https://cdn.atlas.io/renders/test-task.mp4";
const BUNNY_MP4_URL = "https://vz-test.b-cdn.net/guid-rehost/play_720p.mp4";
const BUNNY_HLS_URL = "https://vz-test.b-cdn.net/guid-rehost/playlist.m3u8";
const FAKE_BYTES = Buffer.from("fake-video-bytes");

const BASE_PARAMS = {
  iterationId: "iter-001",
  sessionId: "sess-001",
  provider: "atlas" as const,
  providerTaskId: "task-abc",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("finalizeLabRender — Bunny rehost migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire mocks after clearAllMocks.
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.maybeSingle.mockResolvedValue({ data: null });
    mockSupabase.storage.from.mockReturnValue(mockSupabaseStorage);

    isBunnyConfiguredMock.mockReturnValue(true);
    // clearAllMocks resets the mock implementation; restore the default (HEAD passes).
    validateBunnyMp4UrlMock.mockResolvedValue(true);
    mockDownloadClip.mockResolvedValue(FAKE_BYTES);
    hostVideoOnBunnyMock.mockResolvedValue({
      guid: "guid-rehost",
      mp4Url: BUNNY_MP4_URL,
      hlsUrl: BUNNY_HLS_URL,
      status: 4,
    });
    bunnyStreamCostCentsMock.mockReturnValue(0);
    mockCheckStatus.mockResolvedValue({ status: "done", videoUrl: PROVIDER_URL, costCents: 100 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. happy path — clipUrl is Bunny mp4Url", async () => {
    const result = await finalizeLabRender(BASE_PARAMS);
    expect(result.done).toBe(true);
    expect(result.clipUrl).toBe(BUNNY_MP4_URL);
    expect(hostVideoOnBunnyMock).toHaveBeenCalledOnce();
    const [titleArg, bytesArg] = hostVideoOnBunnyMock.mock.calls[0]!;
    expect(titleArg).toContain(BASE_PARAMS.sessionId);
    expect(titleArg).toContain(BASE_PARAMS.iterationId);
    expect(bytesArg).toEqual(FAKE_BYTES);
  });

  it("2. Bunny unconfigured — falls back to provider URL", async () => {
    isBunnyConfiguredMock.mockReturnValue(false);
    const result = await finalizeLabRender(BASE_PARAMS);
    expect(result.done).toBe(true);
    expect(result.clipUrl).toBe(PROVIDER_URL);
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
  });

  it("3. hostVideoOnBunny throws — falls back to provider URL (no rethrow)", async () => {
    hostVideoOnBunnyMock.mockRejectedValue(new Error("Bunny encode timeout"));
    const result = await finalizeLabRender(BASE_PARAMS);
    expect(result.done).toBe(true);
    expect(result.clipUrl).toBe(PROVIDER_URL);
  });

  it("4. successful host emits provider:bunny cost_event", async () => {
    bunnyStreamCostCentsMock.mockReturnValue(3);
    await finalizeLabRender(BASE_PARAMS);
    const bunnyCall = recordCostEventMock.mock.calls.find(([evt]) => evt.provider === "bunny");
    expect(bunnyCall).toBeDefined();
    const [evt] = bunnyCall!;
    expect(evt.stage).toBe("generation");
    expect(evt.unitsConsumed).toBe(1);
    expect(evt.unitType).toBe("renders");
    expect(evt.costCents).toBe(3);
    expect((evt.metadata as Record<string, unknown>)?.bunny_hosted).toBe(true);
    expect((evt.metadata as Record<string, unknown>)?.source).toBe("prompt_lab");
  });

  it("5. existing atlas render cost_event is still emitted", async () => {
    await finalizeLabRender(BASE_PARAMS);
    const atlasCall = recordCostEventMock.mock.calls.find(([evt]) => evt.provider === "atlas");
    expect(atlasCall).toBeDefined();
  });

  it("6. no supabase storage.upload called for the rehost path", async () => {
    await finalizeLabRender(BASE_PARAMS);
    expect(mockSupabaseStorage.upload).not.toHaveBeenCalled();
  });
});
