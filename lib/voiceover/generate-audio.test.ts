import { describe, it, expect, vi, afterEach } from "vitest";

// generate-audio.ts pulls in ../db.js (Supabase client) at module load; mock it
// so the pure helper can be imported without env/SDK side effects.
vi.mock("../db.js", () => ({
  getSupabase: vi.fn(),
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

import { estimateMp3DurationMs, resolveModelId } from "./generate-audio.js";

// Stock voice IDs from the VOICES catalog
const STOCK_VOICE_IDS = [
  "UgBBYS2sOqTuMpoF3BR0", // Mark
  "dtSEyYGNJqjrtBArPCVZ", // Jack
  "F7hCTbeEDbm7osolS21j", // Amanda
  "kdmDKE6EkgrWrrykO9Qt", // Jessica
];

describe("resolveModelId", () => {
  afterEach(() => {
    delete process.env.ELEVENLABS_MODEL_ID;
    delete process.env.ELEVENLABS_CLIENT_VOICE_MODEL_ID;
  });

  it("stock voice → eleven_v3 by default", () => {
    for (const id of STOCK_VOICE_IDS) {
      expect(resolveModelId(id)).toBe("eleven_v3");
    }
  });

  it("client/cloned voice (not in catalog) → eleven_multilingual_v2 by default", () => {
    expect(resolveModelId("some-cloned-voice-id")).toBe("eleven_multilingual_v2");
    expect(resolveModelId("client-voice-abc123")).toBe("eleven_multilingual_v2");
  });

  it("stock voice respects ELEVENLABS_MODEL_ID env override", () => {
    process.env.ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
    expect(resolveModelId(STOCK_VOICE_IDS[0])).toBe("eleven_flash_v2_5");
  });

  it("client voice respects ELEVENLABS_CLIENT_VOICE_MODEL_ID env override", () => {
    process.env.ELEVENLABS_CLIENT_VOICE_MODEL_ID = "eleven_turbo_v2";
    expect(resolveModelId("custom-client-voice")).toBe("eleven_turbo_v2");
  });

  it("client voice env override does not affect stock voice model", () => {
    process.env.ELEVENLABS_CLIENT_VOICE_MODEL_ID = "eleven_turbo_v2";
    expect(resolveModelId(STOCK_VOICE_IDS[1])).toBe("eleven_v3");
  });

  it("isV3 logic: stock voice with default model yields eleven_v3 (starts with eleven_v3 → tags kept)", () => {
    const modelId = resolveModelId(STOCK_VOICE_IDS[0]);
    expect(modelId.startsWith("eleven_v3")).toBe(true);
  });

  it("isV3 logic: client voice with default model yields eleven_multilingual_v2 (not v3 → tags stripped)", () => {
    const modelId = resolveModelId("client-voice-xyz");
    expect(modelId.startsWith("eleven_v3")).toBe(false);
  });
});

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
