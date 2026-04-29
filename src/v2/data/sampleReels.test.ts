import { describe, it, expect } from "vitest";
import { getSampleReels } from "./sampleReels";

describe("getSampleReels", () => {
  it("returns exactly 3 reels", async () => {
    const reels = await getSampleReels();
    expect(reels).toHaveLength(3);
  });

  it("each reel has required fields", async () => {
    const reels = await getSampleReels();
    for (const reel of reels) {
      expect(reel.id).toMatch(/.+/);
      expect(reel.title).toMatch(/Sample$/);
      expect(reel.durationSec).toBeGreaterThan(0);
      expect(reel.posterUrl).toMatch(/^https?:\/\//);
      expect(reel.videoUrl).toMatch(/^https?:\/\//);
    }
  });
});
