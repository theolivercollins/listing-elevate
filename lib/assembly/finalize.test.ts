/**
 * Tests for lib/assembly/finalize.ts
 *
 * TDD — written before the implementation. Tests cover:
 *   1. Kill switch: LE_ASSEMBLY_FINALIZE=off bypasses all work and returns
 *      the provider URL unchanged.
 *   2. Env guard: Bunny host is skipped when VERCEL_ENV and
 *      LE_ALLOW_NONPROD_WRITES are both absent — returns provider URL but still
 *      downloads + computes bitrate.
 *   3. Download failure: falls back to provider URL without throwing; emits
 *      a warn log.
 *   4. Bunny host failure: falls back to provider URL without throwing; emits
 *      a warn log.
 *   5. Bunny unconfigured: falls back to provider URL without throwing.
 *   6. Happy path: returns the Bunny mp4 URL, computed bitrateKbps, and
 *      outputBytes when everything succeeds; hostVideoOnBunny called with bytes.
 *   7. Bitrate warn fires when computed bitrate is below the pixel-scaled floor.
 *   8. Bitrate warn does NOT fire when computed bitrate is above the floor.
 *   9. ASSEMBLY_MIN_KBPS env var overrides the default floor (and =0 disables).
 *  10. LE_ALLOW_NONPROD_WRITES=true allows the Bunny host without VERCEL_ENV.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Bunny Stream provider. Declared before the unit-under-test import so
// vitest hoists the mock ahead of the module graph.
// ---------------------------------------------------------------------------
vi.mock("../providers/bunny-stream.js", () => ({
  hostVideoOnBunny: vi.fn(),
  isBunnyConfigured: vi.fn(),
  deleteBunnyVideo: vi.fn(),
}));

import { hostVideoOnBunny, isBunnyConfigured, deleteBunnyVideo } from "../providers/bunny-stream.js";
import { finalizeAssemblyRender } from "./finalize.js";

const hostVideoOnBunnyMock = vi.mocked(hostVideoOnBunny);
const isBunnyConfiguredMock = vi.mocked(isBunnyConfigured);
const deleteBunnyVideoMock = vi.mocked(deleteBunnyVideo);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_URL = "https://creatomate.com/renders/abc123.mp4";
const BUNNY_MP4_URL = "https://vz-test.b-cdn.net/guid-123/play_720p.mp4";
const BUNNY_HLS_URL = "https://vz-test.b-cdn.net/guid-123/playlist.m3u8";

function bunnySuccess() {
  return {
    guid: "guid-123",
    mp4Url: BUNNY_MP4_URL,
    hlsUrl: BUNNY_HLS_URL,
    status: 4,
  };
}

// 1 MB of fake video bytes — 30s video → 8000/30 ≈ 267 kbps (well below 9 Mbps floor)
const SMALL_BYTES = new Uint8Array(1_000_000);
// 40 MB of fake video bytes — 30s video → ~10 667 kbps (above floor)
const LARGE_BYTES = new Uint8Array(40_000_000);

function makeFetchResponse(bytes: Uint8Array) {
  return {
    ok: true,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  } as unknown as Response;
}

/** HEAD response helpers */
function makeHeadOk(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}
function makeHeadNotFound(): Response {
  return { ok: false, status: 404 } as unknown as Response;
}

/**
 * Build a sequential fetch stub: first call returns the download response,
 * second call returns the HEAD response. Finalize calls fetch twice on
 * the success path: once to download, once to HEAD-validate the mp4Url.
 */
function makeSequentialFetch(
  downloadResponse: Response,
  headResponse: Response,
): ReturnType<typeof vi.fn> {
  const calls = [downloadResponse, headResponse];
  let idx = 0;
  return vi.fn(() => {
    const r = calls[idx] ?? calls[calls.length - 1];
    idx++;
    return Promise.resolve(r);
  });
}

// ---------------------------------------------------------------------------
// Base params for every call
// ---------------------------------------------------------------------------
const BASE_PARAMS = {
  propertyId: "prop-abc",
  aspectRatio: "16:9" as const,
  providerUrl: PROVIDER_URL,
  durationSeconds: 30,
  version: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("finalizeAssemblyRender", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Restore env modifications between tests.
    delete process.env.LE_ASSEMBLY_FINALIZE;
    delete process.env.VERCEL_ENV;
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    delete process.env.ASSEMBLY_MIN_KBPS;

    hostVideoOnBunnyMock.mockReset();
    isBunnyConfiguredMock.mockReset();
    deleteBunnyVideoMock.mockReset();
    // Default: Bunny configured and host succeeds.
    isBunnyConfiguredMock.mockReturnValue(true);
    hostVideoOnBunnyMock.mockResolvedValue(bunnySuccess());
    // Default: deleteBunnyVideo resolves cleanly.
    deleteBunnyVideoMock.mockResolvedValue(undefined);

    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 1. Kill switch ──────────────────────────────────────────────────────

  it("returns provider URL unchanged when LE_ASSEMBLY_FINALIZE=off", async () => {
    process.env.LE_ASSEMBLY_FINALIZE = "off";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(PROVIDER_URL);
    expect(result.bitrateKbps).toBeNull();
    expect(result.outputBytes).toBeNull();
    expect(result.bunnyWasCalled).toBe(false);
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
  });

  // ── 2. Env guard ────────────────────────────────────────────────────────

  it("skips Bunny host and returns provider URL when env guard is absent", async () => {
    // Neither VERCEL_ENV=production nor LE_ALLOW_NONPROD_WRITES=true
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    // Bunny must not be touched.
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
    // URL falls back to provider.
    expect(result.url).toBe(PROVIDER_URL);
    // Bitrate IS computed from downloaded bytes (we still download).
    expect(result.bitrateKbps).not.toBeNull();
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    expect(result.bunnyWasCalled).toBe(false);
  });

  // ── 3. Download failure ─────────────────────────────────────────────────

  it("falls back to provider URL on download failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network timeout")),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(PROVIDER_URL);
    expect(result.bitrateKbps).toBeNull();
    expect(result.outputBytes).toBeNull();
    expect(result.bunnyWasCalled).toBe(false);
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
    // Must emit a warn — never throw.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  it("falls back to provider URL when fetch returns non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(PROVIDER_URL);
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  // ── 4. Bunny host failure ────────────────────────────────────────────────

  it("falls back to provider URL on Bunny host failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    hostVideoOnBunnyMock.mockRejectedValue(new Error("bunny encode timeout"));
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(PROVIDER_URL);
    // Bitrate + bytes preserved even though host failed.
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    expect(result.bitrateKbps).not.toBeNull();
    expect(result.bunnyWasCalled).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] bunny host failed"),
      expect.anything(),
    );
  });

  // ── 5. Bunny unconfigured ────────────────────────────────────────────────

  it("falls back to provider URL when Bunny is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    isBunnyConfiguredMock.mockReturnValue(false);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(PROVIDER_URL);
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    expect(result.bitrateKbps).not.toBeNull();
    expect(result.bunnyWasCalled).toBe(false);
    expect(hostVideoOnBunnyMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  // ── 6. Happy path ────────────────────────────────────────────────────────

  it("returns Bunny mp4 URL and correct metadata on success", async () => {
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(result.url).toBe(BUNNY_MP4_URL);
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    // bitrateKbps = bytes * 8 / durationSeconds / 1000
    const expectedKbps = Math.round(
      (LARGE_BYTES.byteLength * 8) / BASE_PARAMS.durationSeconds / 1000,
    );
    expect(result.bitrateKbps).toBe(expectedKbps);
    expect(result.bunnyWasCalled).toBe(true);
    // hostVideoOnBunny called with the downloaded bytes.
    expect(hostVideoOnBunnyMock).toHaveBeenCalledTimes(1);
    const [title, bytesArg] = hostVideoOnBunnyMock.mock.calls[0];
    expect(bytesArg).toBeInstanceOf(Uint8Array);
    expect((bytesArg as Uint8Array).byteLength).toBe(LARGE_BYTES.byteLength);
    // Title encodes property + orientation + version.
    expect(title).toContain("prop-abc");
    expect(title).toContain("horizontal");
    expect(title).toContain("v1");
    // No warn because large bytes → high bitrate.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("encodes vertical orientation in the Bunny title for 9:16 aspect ratio", async () => {
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({ ...BASE_PARAMS, aspectRatio: "9:16" });

    const [title] = hostVideoOnBunnyMock.mock.calls[0];
    expect(title).toContain("vertical");
    expect(title).toContain("prop-abc");
    expect(title).toContain("v1");
  });

  // ── 7. Bitrate warn below floor ──────────────────────────────────────────

  it("emits warn when bitrate is below the pixel-scaled floor", async () => {
    // 1 MB over 30 s → ~267 kbps — far below 9000 kbps floor
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(SMALL_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    // Should still succeed (URL is the Bunny mp4 URL — host happened).
    expect(result.url).toBe(BUNNY_MP4_URL);
    // Must warn about low bitrate.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] low bitrate"),
      expect.anything(),
    );
  });

  // ── 8. No bitrate warn above floor ──────────────────────────────────────

  it("does NOT emit a bitrate warn when bitrate is above the floor", async () => {
    // 40 MB over 30 s → ~10 667 kbps — above 9000 kbps floor
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender(BASE_PARAMS);

    const bitrateWarns = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("low bitrate"),
    );
    expect(bitrateWarns).toHaveLength(0);
  });

  // ── 9. ASSEMBLY_MIN_KBPS env override ───────────────────────────────────

  it("uses ASSEMBLY_MIN_KBPS env var as the bitrate floor", async () => {
    // 40 MB / 30 s → ~10 667 kbps; set floor to 20 000 kbps so it triggers
    process.env.ASSEMBLY_MIN_KBPS = "20000";
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender(BASE_PARAMS);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] low bitrate"),
      expect.anything(),
    );
  });

  it("allows ASSEMBLY_MIN_KBPS=0 to disable bitrate warn entirely", async () => {
    process.env.ASSEMBLY_MIN_KBPS = "0";
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(SMALL_BYTES), makeHeadOk()),
    );
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender(BASE_PARAMS);

    const bitrateWarns = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("low bitrate"),
    );
    expect(bitrateWarns).toHaveLength(0);
  });

  // ── 10. LE_ALLOW_NONPROD_WRITES guard ────────────────────────────────────

  it("allows the Bunny host when LE_ALLOW_NONPROD_WRITES=true even without VERCEL_ENV", async () => {
    process.env.LE_ALLOW_NONPROD_WRITES = "true";
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadOk()),
    );

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(hostVideoOnBunnyMock).toHaveBeenCalledTimes(1);
    expect(result.url).toBe(BUNNY_MP4_URL);
  });

  // ── 11. HEAD check: mp4Url 404 → fallback ─────────────────────────────────

  it("falls back to provider URL when HEAD check returns non-ok (MP4 Fallback disabled)", async () => {
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadNotFound()),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    // Bunny was called but the URL was rejected by HEAD → fall back to provider URL.
    expect(hostVideoOnBunnyMock).toHaveBeenCalledTimes(1);
    expect(result.url).toBe(PROVIDER_URL);
    // bitrate and outputBytes are still available (download happened).
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    expect(result.bitrateKbps).not.toBeNull();
    // Bunny WAS called even though url fell back — charges incurred.
    expect(result.bunnyWasCalled).toBe(true);
    // Orphaned Bunny object must be cleaned up.
    expect(deleteBunnyVideoMock).toHaveBeenCalledWith("guid-123");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] mp4Url HEAD check failed"),
      expect.anything(),
    );
  });

  it("falls back to provider URL when HEAD check throws (network error)", async () => {
    // First fetch (download) resolves; second (HEAD) throws.
    let callIdx = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        if (callIdx++ === 0) return Promise.resolve(makeFetchResponse(LARGE_BYTES));
        return Promise.reject(new Error("head network error"));
      }),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    expect(hostVideoOnBunnyMock).toHaveBeenCalledTimes(1);
    expect(result.url).toBe(PROVIDER_URL);
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    // Bunny WAS called even though url fell back — charges incurred.
    expect(result.bunnyWasCalled).toBe(true);
    // Orphaned Bunny object must be cleaned up.
    expect(deleteBunnyVideoMock).toHaveBeenCalledWith("guid-123");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] mp4Url HEAD check threw"),
      expect.anything(),
    );
  });

  // ── 12. Orphan cleanup: deleteBunnyVideo is called when HEAD fails ──────────

  it("emits cost row context and deletes orphaned video when HEAD check fails after successful upload", async () => {
    // Arrange: download succeeds, host succeeds, but HEAD returns 404.
    vi.stubGlobal(
      "fetch",
      makeSequentialFetch(makeFetchResponse(LARGE_BYTES), makeHeadNotFound()),
    );
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender(BASE_PARAMS);

    // The caller must see bunnyWasCalled=true so it can emit a cost row even
    // though url fell back to the provider URL.
    expect(result.bunnyWasCalled).toBe(true);
    expect(result.url).toBe(PROVIDER_URL);
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    expect(result.bitrateKbps).not.toBeNull();

    // deleteBunnyVideo must be called with the hosted guid to clean up the orphan.
    expect(deleteBunnyVideoMock).toHaveBeenCalledWith("guid-123");
  });
});
