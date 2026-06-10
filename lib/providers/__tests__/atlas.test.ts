import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildAtlasRequestBody, parseAtlasSubmitResponse, ATLAS_MODELS, AtlasProvider, atlasClipCostCents } from "../atlas.js";
import { __setTransformForTests } from "../../services/source-aspect.js";
import type { GenerateClipParams } from "../provider.interface.js";

const baseParams: GenerateClipParams = {
  sourceImage: Buffer.from(""),
  sourceImageUrl: "https://cdn.example.com/start.jpg",
  prompt: "slow cinematic push in",
  durationSeconds: 5,
  aspectRatio: "16:9",
};

describe("buildAtlasRequestBody", () => {
  it("maps GenerateClipParams to the Kling v3.0 Pro body with end_image", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: "https://cdn.example.com/end.jpg" },
      ATLAS_MODELS["kling-v3-pro"],
    );
    expect(body.model).toBe("kwaivgi/kling-v3.0-pro/image-to-video");
    expect(body.image).toBe("https://cdn.example.com/start.jpg");
    expect(body.end_image).toBe("https://cdn.example.com/end.jpg");
    expect(body.prompt).toBe("slow cinematic push in");
    expect(body.duration).toBe(5);
    // Wan-only field must not be present on Kling submissions.
    expect((body as unknown as Record<string, unknown>).last_image).toBeUndefined();
  });

  it("maps GenerateClipParams to the Kling v2.1 pair body with end_image", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: "https://cdn.example.com/end.jpg" },
      ATLAS_MODELS["kling-v2-1-pair"],
    );
    expect(body.model).toBe("kwaivgi/kling-v2.1-i2v-pro/start-end-frame");
    expect(body.image).toBe("https://cdn.example.com/start.jpg");
    expect(body.end_image).toBe("https://cdn.example.com/end.jpg");
  });

  it("omits end-frame field when the model's endFrameField is null (master i2v)", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: "https://cdn.example.com/end.jpg" },
      ATLAS_MODELS["kling-v2-master"],
    );
    expect((body as unknown as Record<string, unknown>).end_image).toBeUndefined();
    expect((body as unknown as Record<string, unknown>).last_image).toBeUndefined();
  });

  it("omits the end-frame field when endImageUrl is missing", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: undefined },
      ATLAS_MODELS["kling-v3-pro"],
    );
    expect((body as unknown as Record<string, unknown>).end_image).toBeUndefined();
  });

  it("throws when sourceImageUrl is missing — Atlas requires a hosted URL", () => {
    expect(() =>
      buildAtlasRequestBody(
        { ...baseParams, sourceImageUrl: undefined },
        ATLAS_MODELS["kling-v3-pro"],
      ),
    ).toThrow(/sourceImageUrl/);
  });

  it("clamps duration to the model's supported set", () => {
    const klingShort = buildAtlasRequestBody(
      { ...baseParams, durationSeconds: 3 },
      ATLAS_MODELS["kling-v3-pro"],
    );
    expect(klingShort.duration).toBe(5); // Kling only allows 5 or 10
    const klingLong = buildAtlasRequestBody(
      { ...baseParams, durationSeconds: 12 },
      ATLAS_MODELS["kling-v3-pro"],
    );
    expect(klingLong.duration).toBe(10);
  });

  it("forwards resolution='1080p-SR' for the Seedance SKU descriptor (super-res default — replaced the retired 2K upscale tier)", () => {
    const body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["seedance-pro-pushin"]);
    expect(body.resolution).toBe("1080p-SR");
  });

  it("routes Seedance to the current Seedance 2.0 slug by default (standalone upscaled variant was retired by Atlas)", () => {
    expect(ATLAS_MODELS["seedance-pro-pushin"].slug).toBe(
      "bytedance/seedance-2.0/image-to-video",
    );
  });

  it("Seedance request uses the new slug + 1080p-SR and still omits end_image even when endImageUrl is passed", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: "https://cdn.example.com/end.jpg" },
      ATLAS_MODELS["seedance-pro-pushin"],
    );
    expect(body.model).toBe("bytedance/seedance-2.0/image-to-video");
    expect(body.resolution).toBe("1080p-SR");
    // endFrameField is null on the Seedance descriptor — pairs on Seedance
    // are deliberately not enabled (last_image exists upstream, out of scope).
    expect((body as unknown as Record<string, unknown>).end_image).toBeUndefined();
    expect((body as unknown as Record<string, unknown>).last_image).toBeUndefined();
  });

  it("supportedResolutions for Seedance matches the live Atlas enum (no '2k')", () => {
    const supported = ATLAS_MODELS["seedance-pro-pushin"].supportedResolutions ?? [];
    expect([...supported].sort()).toEqual(
      ["480p", "720p", "720p-SR", "1080p", "1080p-SR", "1440p-SR"].sort(),
    );
    expect(supported).not.toContain("2k" as never);
  });

  it("still honors an explicit per-render resolution override over the descriptor default", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, resolution: "1080p" },
      ATLAS_MODELS["seedance-pro-pushin"],
    );
    expect(body.resolution).toBe("1080p");
  });

  it("omits resolution for Kling descriptors (resolution is fixed in-model)", () => {
    const klingBody = buildAtlasRequestBody(baseParams, ATLAS_MODELS["kling-v2-master"]);
    expect(klingBody.resolution).toBeUndefined();
    const v3Body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["kling-v3-pro"]);
    expect(v3Body.resolution).toBeUndefined();
  });

  it("forwards generate_audio=false on the Seedance SKU (real estate clips should be silent)", () => {
    const body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["seedance-pro-pushin"]);
    expect(body.generate_audio).toBe(false);
  });

  it("omits generate_audio for Kling descriptors (they don't generate audio)", () => {
    const klingBody = buildAtlasRequestBody(baseParams, ATLAS_MODELS["kling-v2-master"]);
    expect(klingBody.generate_audio).toBeUndefined();
  });

  it("Seedance pricing matches the live catalog: 9.6¢/s → 48¢ for a 5s clip", () => {
    expect(ATLAS_MODELS["seedance-pro-pushin"].priceCentsPerSecond).toBe(9.6);
    expect(ATLAS_MODELS["seedance-pro-pushin"].priceCentsPerClip).toBe(48);
    expect(atlasClipCostCents("seedance-pro-pushin", 5)).toBe(48);
  });
});

describe("seedance-pair — opt-in Seedance 2.0 pair mode", () => {
  it("includes last_image (NOT end_image) when endImageUrl is passed", () => {
    const body = buildAtlasRequestBody(
      { ...baseParams, endImageUrl: "https://cdn.example.com/end.jpg" },
      ATLAS_MODELS["seedance-pair"],
    );
    // Schema-confirmed field name (bytedance-seedance-2.0-image-to-video.json).
    expect(body.last_image).toBe("https://cdn.example.com/end.jpg");
    expect((body as unknown as Record<string, unknown>).end_image).toBeUndefined();
  });

  it("omits last_image when endImageUrl is absent", () => {
    const body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["seedance-pair"]);
    expect((body as unknown as Record<string, unknown>).last_image).toBeUndefined();
  });

  it("uses the same Seedance 2.0 slug, 1080p-SR default resolution, and silent audio as the push-in SKU", () => {
    const body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["seedance-pair"]);
    expect(body.model).toBe("bytedance/seedance-2.0/image-to-video");
    expect(body.resolution).toBe("1080p-SR");
    expect(body.generate_audio).toBe(false);
  });

  it("pricing matches the push-in SKU: 9.6¢/s → 48¢ for a 5s clip — verify against invoice", () => {
    expect(ATLAS_MODELS["seedance-pair"].priceCentsPerSecond).toBe(9.6);
    expect(ATLAS_MODELS["seedance-pair"].priceCentsPerClip).toBe(48);
    expect(atlasClipCostCents("seedance-pair", 5)).toBe(48);
    expect(atlasClipCostCents("seedance-pair", 10)).toBe(96);
  });

  it("supportedResolutions mirrors the push-in SKU enum", () => {
    expect(ATLAS_MODELS["seedance-pair"].supportedResolutions).toEqual(
      ATLAS_MODELS["seedance-pro-pushin"].supportedResolutions,
    );
  });

  it("forces 16:9 source crop and 5/10 durations like the push-in SKU", () => {
    expect(ATLAS_MODELS["seedance-pair"].forceSourceAspectRatio).toBe("16:9");
    expect(ATLAS_MODELS["seedance-pair"].allowedDurations).toEqual([5, 10]);
  });
});

describe("parseAtlasSubmitResponse", () => {
  it("extracts the prediction id from a successful submit response", () => {
    const resp = {
      code: 200,
      message: "",
      data: {
        id: "8ba2926c6bd642049f4d17dd68ea6785",
        model: "kwaivgi/kling-v3.0-pro/image-to-video",
        outputs: null,
        urls: { get: "https://api.atlascloud.ai/api/v1/model/prediction/8ba2926c6bd642049f4d17dd68ea6785" },
        status: "processing",
      },
    };
    expect(parseAtlasSubmitResponse(resp)).toBe("8ba2926c6bd642049f4d17dd68ea6785");
  });

  it("throws when the response lacks data.id", () => {
    expect(() => parseAtlasSubmitResponse({ code: 200, data: {} })).toThrow(/id/i);
  });

  it("throws when code is not 200", () => {
    expect(() =>
      parseAtlasSubmitResponse({ code: 402, msg: "insufficient balance", data: null }),
    ).toThrow(/402|balance/i);
  });
});

describe("AtlasProvider.resolveModel (via submit)", () => {
  beforeEach(() => {
    process.env.ATLASCLOUD_API_KEY = "test-key";
    process.env.ATLAS_VIDEO_MODEL = "kling-v3-pro";
  });

  it("uses modelOverride when provided", () => {
    const provider = new AtlasProvider();
    // @ts-expect-error — access private for unit-test resolution
    const resolved = provider.resolveModel("kling-v2-master");
    expect(resolved.slug).toBe("kwaivgi/kling-v2.0-i2v-master");
  });

  it("falls back to env model when override is absent", () => {
    const provider = new AtlasProvider();
    // @ts-expect-error — access private
    const resolved = provider.resolveModel(undefined);
    expect(resolved.slug).toBe("kwaivgi/kling-v3.0-pro/image-to-video");
  });

  it("throws on unknown override", () => {
    const provider = new AtlasProvider();
    // @ts-expect-error — access private
    expect(() => provider.resolveModel("kling-v99")).toThrow(/not registered/);
  });
});

describe("AtlasProvider.generateClip — source aspect-ratio prep", () => {
  beforeEach(() => {
    process.env.ATLASCLOUD_API_KEY = "test-key";
  });
  afterEach(() => {
    __setTransformForTests(null);
    vi.restoreAllMocks();
  });

  it("rewrites the source image URL to a 16:9 crop before submitting Seedance", async () => {
    // Seedance derives its OUTPUT aspect ratio from the INPUT image, so the
    // provider must hand Atlas a 16:9 source. Inject a fake transform to avoid
    // network/sharp; assert the cropped URL is what gets POSTed as `image`.
    __setTransformForTests(async () => "https://cdn.example.com/cropped-16x9.jpg");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { id: "job-123" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AtlasProvider("seedance-pro-pushin");
    const job = await provider.generateClip({ ...baseParams, modelOverride: "seedance-pro-pushin" });

    expect(job.jobId).toBe("job-123");
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.image).toBe("https://cdn.example.com/cropped-16x9.jpg");
  });

  it("crops BOTH the start and end images to 16:9 for seedance-pair submissions", async () => {
    // Pair mode interpolates between two frames; a 3:2 last_image against a
    // 16:9 first frame would skew the geometry, so both get the crop.
    __setTransformForTests(async (url) => `${url}?cropped=16x9`);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { id: "job-pair-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AtlasProvider("seedance-pair");
    await provider.generateClip({
      ...baseParams,
      endImageUrl: "https://cdn.example.com/end.jpg",
      modelOverride: "seedance-pair",
    });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.image).toBe("https://cdn.example.com/start.jpg?cropped=16x9");
    expect(sentBody.last_image).toBe("https://cdn.example.com/end.jpg?cropped=16x9");
    expect(sentBody.end_image).toBeUndefined();
  });

  it("does NOT rewrite the source image URL for Kling (no forced aspect ratio)", async () => {
    const transform = vi.fn();
    __setTransformForTests(transform);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { id: "job-kling" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AtlasProvider("kling-v3-pro");
    await provider.generateClip({ ...baseParams, modelOverride: "kling-v3-pro" });

    expect(transform).not.toHaveBeenCalled();
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.image).toBe("https://cdn.example.com/start.jpg");
  });
});
