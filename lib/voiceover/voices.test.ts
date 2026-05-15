import { describe, it, expect } from "vitest";
import { VOICES, getVoice, isValidVoiceId, WORD_BUDGET } from "./voices.js";

describe("VOICES catalog", () => {
  it("exports exactly 2 voices", () => {
    expect(VOICES).toHaveLength(2);
  });

  it("each voice has required fields", () => {
    for (const v of VOICES) {
      expect(v.id, `${v.name}.id`).toBeTruthy();
      expect(v.name, `${v.name}.name`).toBeTruthy();
      expect(["male", "female"]).toContain(v.gender);
      expect(v.description, `${v.name}.description`).toBeTruthy();
    }
  });

  it("catalog gender split matches design (currently 2 male)", () => {
    const males = VOICES.filter((v) => v.gender === "male");
    const females = VOICES.filter((v) => v.gender === "female");
    expect(males).toHaveLength(2);
    expect(females).toHaveLength(0);
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
