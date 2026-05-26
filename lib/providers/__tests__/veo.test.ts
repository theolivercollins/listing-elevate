// Tests for VeoProvider — Veo 3.1 Preview via Gemini API.
// All fetch calls are mocked; no real network requests are made.

import { describe, it, expect, vi, afterEach } from "vitest";
import { VeoProvider, getCostCentsForVeo, VEO_MAX_DURATION_SECONDS } from "../veo.js";
import type { GenerateClipParams } from "../provider.interface.js";

// ─── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal GenerateClipParams suitable for most tests. */
const baseParams: GenerateClipParams = {
  sourceImage: Buffer.from("fake-image-bytes"),
  sourceImageUrl: "https://cdn.example.com/photo.jpg",
  prompt: "Slow cinematic push in toward the living room.",
  durationSeconds: 5,
  aspectRatio: "16:9",
};

/** Creates a VeoProvider with a mocked GEMINI_API_KEY in process.env. */
function makeProvider(): VeoProvider {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  return new VeoProvider();
}

// Helper to build a fetch mock that returns the given body (JSON).
function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(8),
  });
}

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

// ─── 1. Constructor guard ─────────────────────────────────────────────────────

describe("VeoProvider — constructor", () => {
  it("throws when GEMINI_API_KEY is not set", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => new VeoProvider()).toThrow("GEMINI_API_KEY");
  });

  it("constructs successfully when GEMINI_API_KEY is present", () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(() => new VeoProvider()).not.toThrow();
  });
});

// ─── 2. generateClip — request body shape ────────────────────────────────────

describe("VeoProvider — generateClip", () => {
  it("POSTs to models/veo-3.1-generate-preview:predictLongRunning with the right body shape", async () => {
    const provider = makeProvider();

    // Mock: image fetch (source image download) → simple binary response
    const imageFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("jpeg-bytes").buffer,
    });
    // Mock: generate API call → returns an operation name
    const generateMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: "operations/abc123" }),
    });

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn((...args: unknown[]) => {
      callCount++;
      // First call: download the source image
      if (callCount === 1) return imageFetchMock(...args);
      // Second call: the actual generate API request
      return generateMock(...args);
    }));

    const job = await provider.generateClip(baseParams);

    expect(job.jobId).toBe("operations/abc123");
    expect(job.estimatedSeconds).toBeGreaterThan(0);

    // Inspect the second fetch call (the POST to the generate endpoint).
    const [url, opts] = generateMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("veo-3.1-generate-preview:predictLongRunning");
    expect(url).toContain("key=test-gemini-key");
    expect(opts.method).toBe("POST");

    const parsedBody = JSON.parse(opts.body as string);
    // instances shape
    expect(Array.isArray(parsedBody.instances)).toBe(true);
    expect(parsedBody.instances[0].prompt).toBe(baseParams.prompt);
    expect(parsedBody.instances[0].image.bytesBase64Encoded).toBeDefined();
    expect(typeof parsedBody.instances[0].image.bytesBase64Encoded).toBe("string");
    // parameters shape
    expect(parsedBody.parameters).toBeDefined();
    expect(parsedBody.parameters.durationSeconds).toBe(5);
    expect(parsedBody.parameters.aspectRatio).toBe("16:9");
    expect(parsedBody.parameters.resolution).toBeDefined();
  });

  it("clamps duration to VEO_MAX_DURATION_SECONDS (8s) when scene.durationSeconds > 8", async () => {
    const provider = makeProvider();

    const captured: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        captured.push(JSON.parse(opts.body as string));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/xyz" }),
        arrayBuffer: async () => new ArrayBuffer(4),
      });
    }));

    await provider.generateClip({ ...baseParams, durationSeconds: 20 });
    const body = captured[0] as { parameters: { durationSeconds: number } };
    expect(body.parameters.durationSeconds).toBeLessThanOrEqual(VEO_MAX_DURATION_SECONDS);
  });

  it("asserts parameters.resolution === '4k' for 4K renders", async () => {
    const provider = makeProvider();

    const captured: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        captured.push(JSON.parse(opts.body as string));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/4k-op" }),
        arrayBuffer: async () => new ArrayBuffer(4),
      });
    }));

    await provider.generateClip(baseParams); // default resolution = 4k
    const body = captured[0] as { parameters: { resolution: string } };
    expect(body.parameters.resolution).toBe("4k");
  });
});

// ─── 3. checkStatus — status mapping ─────────────────────────────────────────

describe("VeoProvider — checkStatus", () => {
  it("maps done: true + response.video.uri → complete with URL", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        done: true,
        response: { video: { uri: "https://storage.googleapis.com/video.mp4" } },
      }),
    );

    const result = await provider.checkStatus("operations/abc123");
    expect(result.status).toBe("complete");
    expect(result.videoUrl).toBe("https://storage.googleapis.com/video.mp4");
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("maps done: true + error → failed", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        done: true,
        error: { code: 500, message: "Veo internal error" },
      }),
    );

    const result = await provider.checkStatus("operations/abc123");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Veo internal error");
  });

  it("maps done: false → processing", async () => {
    const provider = makeProvider();
    vi.stubGlobal("fetch", mockFetch({ done: false }));

    const result = await provider.checkStatus("operations/abc123");
    expect(result.status).toBe("processing");
  });

  it("polls the correct URL: {BASE}/{operationName}?key=...", async () => {
    const provider = makeProvider();
    const fetchMock = mockFetch({
      done: true,
      response: { video: { uri: "https://example.com/out.mp4" } },
    });
    vi.stubGlobal("fetch", fetchMock);

    await provider.checkStatus("operations/test-op-456");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("operations/test-op-456");
    expect(url).toContain("key=test-gemini-key");
  });
});

// ─── 4. downloadClip ─────────────────────────────────────────────────────────

describe("VeoProvider — downloadClip", () => {
  it("fetches the URI and returns a Buffer", async () => {
    const provider = makeProvider();
    const fakeBytes = Buffer.from("fake-video-data");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeBytes.buffer,
      }),
    );

    const buf = await provider.downloadClip("https://storage.googleapis.com/video.mp4");
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

// ─── 5. getCostCentsForVeo helper ────────────────────────────────────────────

describe("getCostCentsForVeo", () => {
  it("returns durationSeconds * 50 for 4k", () => {
    expect(getCostCentsForVeo(5, "4k")).toBe(250);
    expect(getCostCentsForVeo(8, "4k")).toBe(400);
  });

  it("returns durationSeconds * 25 for 1080p", () => {
    expect(getCostCentsForVeo(5, "1080p")).toBe(125);
  });

  it("returns durationSeconds * 15 for 720p", () => {
    expect(getCostCentsForVeo(5, "720p")).toBe(75);
  });
});
