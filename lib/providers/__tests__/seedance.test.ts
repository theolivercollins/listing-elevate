import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { GenerateClipParams } from "../provider.interface.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
}

const baseParams: GenerateClipParams = {
  sourceImage: Buffer.from(""),
  sourceImageUrl: "https://cdn.example.com/photo.jpg",
  prompt: "slow push in toward the room",
  durationSeconds: 5,
  aspectRatio: "16:9",
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = "test-replicate-token";
  // Clear any pinned SHA override so tests use the default constant
  delete process.env.SEEDANCE_VERSION_SHA;
});

afterEach(() => {
  delete process.env.REPLICATE_API_TOKEN;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Import after env is set — dynamic import so the module re-reads process.env
// in each test's beforeEach.  For the constructor-throw test we wipe the key.
// ---------------------------------------------------------------------------

async function getProvider() {
  // Force a fresh module evaluation so the constructor sees the current env.
  vi.resetModules();
  const { SeedanceProvider } = await import("../seedance.js");
  return new SeedanceProvider();
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("SeedanceProvider constructor", () => {
  it("throws when REPLICATE_API_TOKEN is missing", async () => {
    delete process.env.REPLICATE_API_TOKEN;
    vi.resetModules();
    const { SeedanceProvider } = await import("../seedance.js");
    expect(() => new SeedanceProvider()).toThrow(/REPLICATE_API_TOKEN/);
  });

  it("constructs successfully when REPLICATE_API_TOKEN is set", async () => {
    const provider = await getProvider();
    expect(provider).toBeDefined();
    expect(provider.name).toBe("seedance");
  });
});

// ---------------------------------------------------------------------------
// generateClip
// ---------------------------------------------------------------------------

describe("SeedanceProvider.generateClip", () => {
  it("POSTs to the correct Replicate endpoint with the right body shape", async () => {
    const mockFetch = makeFetch({ id: "pred-abc123" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = await getProvider();
    const job = await provider.generateClip(baseParams);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token test-replicate-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.input.image).toBe("https://cdn.example.com/photo.jpg");
    expect(body.input.prompt).toBe("slow push in toward the room");
    expect(body.input.duration).toBe(5);
    expect(body.input.resolution).toBe("1080p");
    expect(body.input.aspect_ratio).toBe("16:9");
    // endImageUrl is silently ignored — no end_frame field in the body
    expect(body.input.end_frame).toBeUndefined();
  });

  it("maps 9:16 aspectRatio correctly", async () => {
    const mockFetch = makeFetch({ id: "pred-portrait" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = await getProvider();
    await provider.generateClip({ ...baseParams, aspectRatio: "9:16" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.aspect_ratio).toBe("9:16");
  });

  it("returns { jobId, estimatedSeconds: 120 }", async () => {
    vi.stubGlobal("fetch", makeFetch({ id: "pred-xyz" }));

    const provider = await getProvider();
    const job = await provider.generateClip(baseParams);

    expect(job.jobId).toBe("pred-xyz");
    expect(job.estimatedSeconds).toBe(120);
  });

  it("silently ignores endImageUrl", async () => {
    const mockFetch = makeFetch({ id: "pred-end-ignored" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = await getProvider();
    await provider.generateClip({
      ...baseParams,
      endImageUrl: "https://cdn.example.com/end.jpg",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.end_image).toBeUndefined();
    expect(body.input.last_image).toBeUndefined();
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal("fetch", makeFetch({ detail: "Unauthorized" }, 401));

    const provider = await getProvider();
    await expect(provider.generateClip(baseParams)).rejects.toThrow(/401/);
  });
});

// ---------------------------------------------------------------------------
// checkStatus — status mapping
// ---------------------------------------------------------------------------

describe("SeedanceProvider.checkStatus", () => {
  it("returns { status: 'processing' } for Replicate status 'starting'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "starting" }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams); // seed lastDurationSeconds
    const result = await provider.checkStatus("pred-1");
    expect(result.status).toBe("processing");
  });

  it("returns { status: 'processing' } for Replicate status 'processing'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-2" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "processing" }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    const result = await provider.checkStatus("pred-2");
    expect(result.status).toBe("processing");
  });

  it("returns complete with videoUrl and correct cost on 'succeeded'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-3" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "succeeded",
              output: ["https://replicate.delivery/video.mp4"],
            }),
        }),
    );

    const provider = await getProvider();
    // durationSeconds = 5 → costCents = 5 * 12 = 60
    await provider.generateClip({ ...baseParams, durationSeconds: 5 });
    const result = await provider.checkStatus("pred-3");

    expect(result.status).toBe("complete");
    expect(result.videoUrl).toBe("https://replicate.delivery/video.mp4");
    expect(result.costCents).toBe(60);
    expect(result.providerUnits).toBe(5);
    expect(result.providerUnitType).toBe("seconds");
  });

  it("cost math: 10-second clip → costCents = 120", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-10s" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "succeeded",
              output: ["https://replicate.delivery/video-10s.mp4"],
            }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip({ ...baseParams, durationSeconds: 10 });
    const result = await provider.checkStatus("pred-10s");

    expect(result.costCents).toBe(120);
  });

  it("returns { status: 'failed' } with error from response for 'failed'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-fail" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: "failed", error: "Out of memory" }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    const result = await provider.checkStatus("pred-fail");

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Out of memory");
  });

  it("returns { status: 'failed', error: 'unknown' } when error field is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-fail2" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "failed" }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    const result = await provider.checkStatus("pred-fail2");

    expect(result.status).toBe("failed");
    expect(result.error).toBe("unknown");
  });

  it("returns { status: 'failed' } for Replicate status 'canceled'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-cancel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: "canceled", error: "User canceled" }),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    const result = await provider.checkStatus("pred-cancel");

    expect(result.status).toBe("failed");
    expect(result.error).toBe("User canceled");
  });

  it("GETs the correct Replicate predictions URL", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "pred-url-check" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "processing" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    await provider.checkStatus("pred-url-check");

    const [statusUrl, statusInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(statusUrl).toBe("https://api.replicate.com/v1/predictions/pred-url-check");
    const headers = statusInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token test-replicate-token");
  });

  it("throws on non-2xx status check response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "pred-err" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
        }),
    );

    const provider = await getProvider();
    await provider.generateClip(baseParams);
    await expect(provider.checkStatus("pred-err")).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// downloadClip
// ---------------------------------------------------------------------------

describe("SeedanceProvider.downloadClip", () => {
  it("returns a Buffer from the video URL", async () => {
    const fakeData = new Uint8Array([1, 2, 3, 4, 5]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(fakeData.buffer),
      }),
    );

    const provider = await getProvider();
    const buf = await provider.downloadClip("https://replicate.delivery/video.mp4");

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("fetches from the exact URL provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = await getProvider();
    await provider.downloadClip("https://replicate.delivery/clips/my-clip.mp4");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://replicate.delivery/clips/my-clip.mp4",
    );
  });

  it("throws on non-2xx download response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      }),
    );

    const provider = await getProvider();
    await expect(
      provider.downloadClip("https://replicate.delivery/forbidden.mp4"),
    ).rejects.toThrow(/403/);
  });
});
