// lib/blog-engine/image-tagging.test.ts
import { describe, it, expect, vi } from "vitest";
import { tagImage, _testing } from "./image-tagging";

describe("tagImage", () => {
  const fakeBuffer = Buffer.from("fake");

  it("returns parsed tags + caption + embedding on happy path", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["interior", "lifestyle"], "caption": "A bright living room"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0.1));

    const result = await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg" },
      { vision: visionCall, embed: embedCall },
    );

    expect(result.tags).toEqual(["interior", "lifestyle"]);
    expect(result.caption).toBe("A bright living room");
    expect(result.embedding).toHaveLength(768);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("drops out-of-vocab tags but keeps in-vocab", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["interior", "kitchen"], "caption": "Kitchen"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0));

    const result = await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg" },
      { vision: visionCall, embed: embedCall },
    );

    expect(result.tags).toEqual(["interior"]);
  });

  it("throws on non-JSON vision response", async () => {
    const visionCall = vi.fn().mockResolvedValue({ text: "not json" });
    const embedCall = vi.fn();
    await expect(
      tagImage({ buffer: fakeBuffer, filename: "x.jpg" }, { vision: visionCall, embed: embedCall }),
    ).rejects.toThrow(/parse/i);
  });

  it("includes folderHint in the vision prompt", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["aerial"], "caption": "An aerial drone shot"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0));
    await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg", folderHint: "aerials" },
      { vision: visionCall, embed: embedCall },
    );
    const callArgs = visionCall.mock.calls[0][0];
    expect(callArgs.prompt).toMatch(/aerials/i);
  });

  it("vocab list is exhaustive", () => {
    expect(_testing.VOCAB).toEqual([
      "aerial","exterior","interior","team","area","lifestyle","event",
      "seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter",
      "data_chart",
    ]);
  });
});
