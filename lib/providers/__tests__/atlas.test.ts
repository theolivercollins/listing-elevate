import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildAtlasRequestBody, parseAtlasSubmitResponse, ATLAS_MODELS, AtlasProvider } from "../atlas.js";
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

  it("forwards resolution='1080p' for the Seedance SKU descriptor", () => {
    const body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["seedance-pro-pushin"]);
    expect(body.resolution).toBe("1080p");
  });

  it("omits resolution for Kling descriptors (resolution is fixed in-model)", () => {
    const klingBody = buildAtlasRequestBody(baseParams, ATLAS_MODELS["kling-v2-master"]);
    expect(klingBody.resolution).toBeUndefined();
    const v3Body = buildAtlasRequestBody(baseParams, ATLAS_MODELS["kling-v3-pro"]);
    expect(v3Body.resolution).toBeUndefined();
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
