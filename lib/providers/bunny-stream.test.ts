/**
 * Tests for the new helpers in lib/providers/bunny-stream.ts:
 *   - hostVideoOnBunny()
 *   - bunnyStreamCostCents()
 *
 * TDD — written before the implementation. Tests cover:
 *   1. hostVideoOnBunny success path: create -> upload -> poll -> FINISHED -> returns mp4Url
 *   2. hostVideoOnBunny throws when poll returns ERROR (status 5)
 *   3. hostVideoOnBunny throws on poll timeout (never reaches FINISHED)
 *   4. bunnyStreamCostCents(0) === 0
 *   5. bunnyStreamCostCents(1 GB) returns the configured per-GB cents
 *
 * Mocks global fetch (no real network), using vi.stubGlobal following
 * finalize.test.ts patterns. Poll loop kept instant via small maxAttempts/intervalMs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { hostVideoOnBunny, bunnyStreamCostCents, bestMp4Res, BUNNY_STATUS } from "./bunny-stream.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FAKE_GUID = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";
const FAKE_CDN = "cdn.example.b-cdn.net";

// ---------------------------------------------------------------------------
// Helpers to build Bunny API fetch responses
// ---------------------------------------------------------------------------

function createResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Build a sequential fetch mock:
 *  1. POST /library/{id}/videos -> createVideo -> { guid }
 *  2. PUT /library/{id}/videos/{guid} -> upload -> ok
 *  3+ GET /library/{id}/videos/{guid} -> poll -> BunnyVideo with given status
 */
function buildFetchSequence(pollStatuses: number[]): ReturnType<typeof vi.fn> {
  const calls: Response[] = [
    // 1. createVideo
    createResponse({ guid: FAKE_GUID }),
    // 2. uploadBytes (PUT) -- empty 200
    createResponse({}),
    // 3+. poll responses
    ...pollStatuses.map((s) =>
      createResponse({
        guid: FAKE_GUID,
        title: "test",
        status: s,
        length: 30,
        width: 1920,
        height: 1080,
        thumbnailFileName: null,
        availableResolutions: "720p,1080p",
        encodeProgress: s === BUNNY_STATUS.FINISHED ? 100 : 50,
      }),
    ),
  ];
  let idx = 0;
  return vi.fn((_url: string, _init?: RequestInit) => {
    const r = calls[idx] ?? calls[calls.length - 1];
    idx++;
    return Promise.resolve(r);
  });
}

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------
function setEnv() {
  process.env.BUNNY_STREAM_API_KEY = "fake-api-key";
  process.env.BUNNY_STREAM_LIBRARY_ID = "12345";
  process.env.BUNNY_STREAM_CDN_HOSTNAME = FAKE_CDN;
}

function clearEnv() {
  delete process.env.BUNNY_STREAM_API_KEY;
  delete process.env.BUNNY_STREAM_LIBRARY_ID;
  delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
  delete process.env.BUNNY_STREAM_CENTS_PER_GB;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hostVideoOnBunny", () => {
  beforeEach(() => {
    setEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearEnv();
  });

  // -- 1. Success path -------------------------------------------------------

  it("creates, uploads, polls and returns mp4Url containing the guid after status 4", async () => {
    // Poll: one intermediate state (PROCESSING), then FINISHED
    vi.stubGlobal("fetch", buildFetchSequence([BUNNY_STATUS.PROCESSING, BUNNY_STATUS.FINISHED]));

    const result = await hostVideoOnBunny("test video", new Uint8Array(100), {
      maxAttempts: 5,
      intervalMs: 0,
    });

    expect(result.guid).toBe(FAKE_GUID);
    expect(result.status).toBe(BUNNY_STATUS.FINISHED);
    // mp4Url must contain the guid and resolve to the highest available rendition
    // (mock returns availableResolutions:"720p,1080p" → bestMp4Res picks "1080p")
    expect(result.mp4Url).toContain(FAKE_GUID);
    expect(result.mp4Url).toContain(FAKE_CDN);
    expect(result.mp4Url).toMatch(/\.mp4$/);
    // Resolution must be >=1080p — this is the core regression guard.
    // bestMp4Res("720p,1080p") must return "1080p", not "720p".
    expect(result.mp4Url).toContain("1080p");
    expect(result.mp4Url).not.toContain("720p");
    // hlsUrl also returned
    expect(result.hlsUrl).toContain(FAKE_GUID);
    expect(result.hlsUrl).toContain("playlist.m3u8");
  });

  it("resolves immediately when first poll response is already FINISHED", async () => {
    vi.stubGlobal("fetch", buildFetchSequence([BUNNY_STATUS.FINISHED]));

    const result = await hostVideoOnBunny("test video", new Uint8Array(50), {
      maxAttempts: 3,
      intervalMs: 0,
    });

    expect(result.status).toBe(BUNNY_STATUS.FINISHED);
    expect(result.mp4Url).toContain(FAKE_GUID);
  });

  // -- 2. Throws on ERROR status ---------------------------------------------

  it("throws when poll returns ERROR status (5)", async () => {
    vi.stubGlobal("fetch", buildFetchSequence([BUNNY_STATUS.PROCESSING, BUNNY_STATUS.ERROR]));

    await expect(
      hostVideoOnBunny("test video", new Uint8Array(100), { maxAttempts: 5, intervalMs: 0 }),
    ).rejects.toThrow(/error|failed/i);
  });

  it("throws when poll returns UPLOAD_FAILED status (6)", async () => {
    vi.stubGlobal("fetch", buildFetchSequence([BUNNY_STATUS.UPLOAD_FAILED]));

    await expect(
      hostVideoOnBunny("test video", new Uint8Array(100), { maxAttempts: 5, intervalMs: 0 }),
    ).rejects.toThrow(/error|failed/i);
  });

  // -- 3. Throws on poll timeout ---------------------------------------------

  it("throws when poll loop exhausts maxAttempts without reaching FINISHED", async () => {
    // Always return PROCESSING -- never finishes
    vi.stubGlobal(
      "fetch",
      buildFetchSequence([
        BUNNY_STATUS.PROCESSING,
        BUNNY_STATUS.PROCESSING,
        BUNNY_STATUS.PROCESSING,
        BUNNY_STATUS.PROCESSING,
        BUNNY_STATUS.PROCESSING,
      ]),
    );

    await expect(
      hostVideoOnBunny("test video", new Uint8Array(100), { maxAttempts: 3, intervalMs: 0 }),
    ).rejects.toThrow(/timeout|timed out|exceeded/i);
  });
});

// ---------------------------------------------------------------------------
// bunnyStreamCostCents
// ---------------------------------------------------------------------------

describe("bunnyStreamCostCents", () => {
  afterEach(() => {
    delete process.env.BUNNY_STREAM_CENTS_PER_GB;
  });

  it("returns 0 for 0 bytes", () => {
    expect(bunnyStreamCostCents(0)).toBe(0);
  });

  it("returns an integer >= 0 for any positive bytes", () => {
    const result = bunnyStreamCostCents(5_000_000); // 5 MB
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("returns the configured per-GB cents for exactly 1 GB input", () => {
    // Default BUNNY_STREAM_CENTS_PER_GB = 1
    const oneGb = 1_073_741_824;
    expect(bunnyStreamCostCents(oneGb)).toBe(1);
  });

  it("respects BUNNY_STREAM_CENTS_PER_GB env override", () => {
    process.env.BUNNY_STREAM_CENTS_PER_GB = "5";
    const oneGb = 1_073_741_824;
    expect(bunnyStreamCostCents(oneGb)).toBe(5);
  });

  it("a sub-1GB video legitimately rounds to 0 cents (correct, must still record)", () => {
    // 50 MB -- (50/1024) * 1c ~ 0.049c -> rounds to 0 -- correct
    const fiftyMb = 50_000_000;
    expect(bunnyStreamCostCents(fiftyMb)).toBe(0);
  });

  it("larger videos accumulate non-zero cost (10 GB)", () => {
    const tenGb = 10 * 1_073_741_824;
    expect(bunnyStreamCostCents(tenGb)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// bestMp4Res — resolution selection
// ---------------------------------------------------------------------------

describe("bestMp4Res", () => {
  it("picks 1080p when available alongside 720p", () => {
    expect(bestMp4Res("240p,360p,480p,720p,1080p")).toBe("1080p");
  });

  it("picks original when present (highest priority)", () => {
    expect(bestMp4Res("480p,720p,1080p,original")).toBe("original");
  });

  it("picks 720p as best when only lower resolutions absent", () => {
    expect(bestMp4Res("240p,480p,720p")).toBe("720p");
  });

  it("falls back to 720p for null availableResolutions", () => {
    expect(bestMp4Res(null)).toBe("720p");
  });

  it("falls back to 720p for empty string", () => {
    expect(bestMp4Res("")).toBe("720p");
  });

  it("is case-insensitive", () => {
    expect(bestMp4Res("240P,720P,1080P")).toBe("1080p");
  });

  it("trims whitespace from Bunny comma-separated values", () => {
    expect(bestMp4Res("720p, 1080p")).toBe("1080p");
  });

  it("never returns a resolution not in the allowed list (rejects unknown labels)", () => {
    // "2160p" is not in RESOLUTION_PREFERENCE, so fallback to 720p
    expect(bestMp4Res("2160p")).toBe("720p");
  });
});
