import { describe, it, expect, vi } from "vitest";

// generate-audio.ts pulls in ../db.js (Supabase client) at module load; mock it
// so the pure helper can be imported without env/SDK side effects.
vi.mock("../db.js", () => ({
  getSupabase: vi.fn(),
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

import { estimateMp3DurationMs } from "./generate-audio.js";

describe("estimateMp3DurationMs", () => {
  it("converts byte length to ms at the default 128 kbps (mp3_44100_128)", () => {
    // 128 kbps = 16,000 bytes per second.
    expect(estimateMp3DurationMs(16_000)).toBe(1_000);
    expect(estimateMp3DurationMs(240_000)).toBe(15_000);
  });

  it("flags a 15s-target overrun: 17.2s of audio is > 16s (target + 1s tolerance)", () => {
    // 17.2s at 128 kbps = 275,200 bytes — the prod-failure shape.
    const durationMs = estimateMp3DurationMs(275_200);
    expect(durationMs).toBe(17_200);
    expect(durationMs).toBeGreaterThan(15_000 + 1_000);
  });

  it("respects an explicit bitrate", () => {
    // 192 kbps = 24,000 bytes per second.
    expect(estimateMp3DurationMs(24_000, 192)).toBe(1_000);
    // 64 kbps = 8,000 bytes per second.
    expect(estimateMp3DurationMs(8_000, 64)).toBe(1_000);
  });

  it("rounds to the nearest millisecond", () => {
    // 100 bytes * 8 / 128 = 6.25 → 6 ms.
    expect(estimateMp3DurationMs(100)).toBe(6);
  });

  it("returns 0 for empty or invalid input", () => {
    expect(estimateMp3DurationMs(0)).toBe(0);
    expect(estimateMp3DurationMs(-5)).toBe(0);
    expect(estimateMp3DurationMs(16_000, 0)).toBe(0);
  });
});
