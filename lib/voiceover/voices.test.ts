import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VOICES, getVoice, isValidVoiceId, defaultVoiceId, WORD_BUDGET } from "./voices.js";

const BRIAN_ID = "nPczCjzI2devNBz1zQrb";

describe("VOICES catalog", () => {
  it("exports exactly 5 voices", () => {
    expect(VOICES).toHaveLength(5);
  });

  it("each voice has required fields", () => {
    for (const v of VOICES) {
      expect(v.id, `${v.name}.id`).toBeTruthy();
      expect(v.name, `${v.name}.name`).toBeTruthy();
      expect(["male", "female"]).toContain(v.gender);
      expect(v.description, `${v.name}.description`).toBeTruthy();
    }
  });

  it("catalog gender split matches design (3 male, 2 female)", () => {
    const males = VOICES.filter((v) => v.gender === "male");
    const females = VOICES.filter((v) => v.gender === "female");
    expect(males).toHaveLength(3);
    expect(females).toHaveLength(2);
  });

  it("includes Brian as a verified male voice (no more 'Brian doesn't exist')", () => {
    const brian = VOICES.find((v) => v.name === "Brian");
    expect(brian).toBeDefined();
    expect(brian?.gender).toBe("male");
    expect(brian?.id).toBe(BRIAN_ID);
  });

  it("getVoice returns correct voice by id", () => {
    const mark = getVoice("UgBBYS2sOqTuMpoF3BR0");
    expect(mark?.name).toBe("Mark");
    expect(mark?.gender).toBe("male");
  });

  it("getVoice returns undefined for unknown id", () => {
    expect(getVoice("unknown-id")).toBeUndefined();
  });

  it("isValidVoiceId returns true for all known voices", () => {
    for (const v of VOICES) {
      expect(isValidVoiceId(v.id)).toBe(true);
    }
  });

  it("isValidVoiceId returns false for garbage input", () => {
    expect(isValidVoiceId("")).toBe(false);
    expect(isValidVoiceId("fake-voice-id")).toBe(false);
  });
});

describe("defaultVoiceId", () => {
  const originalEnv = process.env.ELEVENLABS_DEFAULT_VOICE_ID;

  beforeEach(() => {
    delete process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ELEVENLABS_DEFAULT_VOICE_ID;
    } else {
      process.env.ELEVENLABS_DEFAULT_VOICE_ID = originalEnv;
    }
  });

  it("returns Brian's id by default (not a female voice)", () => {
    const id = defaultVoiceId();
    expect(id).toBe(BRIAN_ID);
    expect(getVoice(id)?.gender).toBe("male");
    expect(getVoice(id)?.name).toBe("Brian");
  });

  it("an unmatched LLM tone pick falls back to Brian, not a female voice", () => {
    // Mirrors the resolveVoiceover miss path in lib/delivery/auto-run.ts:
    // voiceNameMap lookup on an unrecognized name falls through to defaultVoiceId().
    const voiceNameMap: Record<string, string> = Object.fromEntries(
      VOICES.map((v) => [v.name.toLowerCase(), v.id]),
    );
    const tonePick = "Some Unrecognized Tone";
    const voiceId = voiceNameMap[tonePick.toLowerCase()] ?? defaultVoiceId();
    expect(voiceId).toBe(BRIAN_ID);
    expect(getVoice(voiceId)?.gender).toBe("male");
  });

  it("respects ELEVENLABS_DEFAULT_VOICE_ID override when valid", () => {
    process.env.ELEVENLABS_DEFAULT_VOICE_ID = "UgBBYS2sOqTuMpoF3BR0"; // Mark
    expect(defaultVoiceId()).toBe("UgBBYS2sOqTuMpoF3BR0");
  });

  it("falls back to Brian when ELEVENLABS_DEFAULT_VOICE_ID is invalid", () => {
    process.env.ELEVENLABS_DEFAULT_VOICE_ID = "not-a-real-voice-id";
    expect(defaultVoiceId()).toBe(BRIAN_ID);
  });
});

describe("WORD_BUDGET", () => {
  it("provides budgets for all valid durations", () => {
    expect(WORD_BUDGET[15]).toBe(37);
    expect(WORD_BUDGET[30]).toBe(75);
    expect(WORD_BUDGET[60]).toBe(150);
  });

  it("15s budget is smallest and 60s is largest", () => {
    expect(WORD_BUDGET[15]).toBeLessThan(WORD_BUDGET[30]);
    expect(WORD_BUDGET[30]).toBeLessThan(WORD_BUDGET[60]);
  });
});
