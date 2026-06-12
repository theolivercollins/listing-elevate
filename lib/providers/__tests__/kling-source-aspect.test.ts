/**
 * kling-source-aspect.test.ts
 *
 * Asserts the direct-native Kling provider center-crops the source photo to
 * 16:9 before submitting image2video.
 *
 * Root cause (2026-06-11 5019 San Massimo diagnosis,
 * docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md): Kling i2v
 * derives its OUTPUT geometry from the INPUT image and ignores the
 * `aspect_ratio` field — a 3:2 MLS photo yields a 1172×784 clip, which the
 * assembler then cover-upscales 1.64x onto the 1920×1080 canvas. That upscale
 * is the dominant quality loss in assembled videos. The fix routes the source
 * URL through ensureSourceAspectRatio (lib/services/source-aspect.ts), the
 * same 16:9 center-crop Seedance already uses via atlas.ts
 * forceSourceAspectRatio.
 *
 * HONEST LIMIT: native kling-v2-master has a FIXED ~0.92 MP output budget
 * (ffprobe audit 2026-06-11) — the crop yields a uniform 16:9 ~1280×720 clip
 * (clean 1.5x assembly upscale, zero crop), NOT 1080p. The 1080p-class fix
 * for primary routes lives in atlas.ts (2.07 MP-budget SKUs + same crop).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KlingProvider } from "../kling.js";
import { __setTransformForTests } from "../../services/source-aspect.js";

describe("KlingProvider.generateClip — source aspect-ratio prep", () => {
  beforeEach(() => {
    process.env.KLING_ACCESS_KEY = "test-ak";
    process.env.KLING_SECRET_KEY = "test-sk";
  });
  afterEach(() => {
    __setTransformForTests(null);
    vi.restoreAllMocks();
  });

  it("rewrites the source image URL to a 16:9 crop before submitting", async () => {
    // Inject a fake transform to avoid network/sharp; assert the cropped URL
    // is what gets POSTed as `image`.
    const transform = vi.fn(async () => "https://cdn.example.com/cropped-16x9.jpg");
    __setTransformForTests(transform);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { task_id: "task-123" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KlingProvider();
    const job = await provider.generateClip({
      sourceImage: Buffer.from(""),
      sourceImageUrl: "https://cdn.example.com/photo-3x2.jpg",
      prompt: "slow cinematic push in",
      durationSeconds: 5,
      aspectRatio: "16:9",
    });

    expect(job.jobId).toBe("task-123");
    // Crop requested for the original photo at the default 1920×1080 target.
    expect(transform).toHaveBeenCalledWith("https://cdn.example.com/photo-3x2.jpg", 1920, 1080);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.image).toBe("https://cdn.example.com/cropped-16x9.jpg");
  });

  it("falls back to base64 (no crop) when no source URL is provided", async () => {
    const transform = vi.fn();
    __setTransformForTests(transform);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { task_id: "task-b64" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KlingProvider();
    await provider.generateClip({
      sourceImage: Buffer.from("fake-image-bytes"),
      prompt: "slow cinematic push in",
      durationSeconds: 5,
      aspectRatio: "16:9",
    });

    expect(transform).not.toHaveBeenCalled();
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.image).toBe(Buffer.from("fake-image-bytes").toString("base64"));
  });
});
