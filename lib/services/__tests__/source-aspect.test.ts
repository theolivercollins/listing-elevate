import { describe, expect, it, afterEach } from "vitest";
import {
  aspectRatioMatches,
  ensureSourceAspectRatio,
  __setTransformForTests,
} from "../source-aspect.js";

describe("aspectRatioMatches", () => {
  it("returns true for an exact 16:9 frame (1920×1080)", () => {
    expect(aspectRatioMatches(1920, 1080, 1920, 1080)).toBe(true);
  });

  it("returns true for a 16:9 frame at a different scale (3840×2160)", () => {
    expect(aspectRatioMatches(3840, 2160, 1920, 1080)).toBe(true);
  });

  it("returns false for a 3:2 frame (1264×842) — the real-estate photo case", () => {
    expect(aspectRatioMatches(1264, 842, 1920, 1080)).toBe(false);
  });

  it("returns false for a 4:3 frame (1664×1248) — Seedance's snapped output", () => {
    expect(aspectRatioMatches(1664, 1248, 1920, 1080)).toBe(false);
  });

  it("tolerates sub-1% rounding (1920×1081 still counts as 16:9)", () => {
    expect(aspectRatioMatches(1920, 1081, 1920, 1080)).toBe(true);
  });

  it("returns false for zero / missing dimensions", () => {
    expect(aspectRatioMatches(0, 0, 1920, 1080)).toBe(false);
  });
});

describe("ensureSourceAspectRatio (via test seam)", () => {
  afterEach(() => __setTransformForTests(null));

  it("delegates to the injected transform when set", async () => {
    __setTransformForTests(async (url) => `${url}#cropped`);
    const out = await ensureSourceAspectRatio("https://cdn.example.com/photo.jpg");
    expect(out).toBe("https://cdn.example.com/photo.jpg#cropped");
  });
});
