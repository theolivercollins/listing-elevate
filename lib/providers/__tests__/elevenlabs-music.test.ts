import { describe, it, expect } from "vitest";
import {
  buildMusicComposeRequest,
  MOOD_PROMPTS,
  MUSIC_MIN_MS,
  MUSIC_MAX_MS,
} from "../elevenlabs-music.js";

describe("buildMusicComposeRequest", () => {
  it("passes through a valid prompt + length", () => {
    const req = buildMusicComposeRequest("warm instrumental", 40_000);
    expect(req).toEqual({ prompt: "warm instrumental", music_length_ms: 40_000 });
  });

  it("clamps length to the API min/max", () => {
    expect(buildMusicComposeRequest("x", 100).music_length_ms).toBe(MUSIC_MIN_MS);
    expect(buildMusicComposeRequest("x", 9_999_999).music_length_ms).toBe(MUSIC_MAX_MS);
  });

  it("trims the prompt and rounds the length", () => {
    const req = buildMusicComposeRequest("  hi  ", 40_500.7);
    expect(req.prompt).toBe("hi");
    expect(req.music_length_ms).toBe(40_501);
  });

  it("throws on an empty prompt", () => {
    expect(() => buildMusicComposeRequest("", 40_000)).toThrow();
    expect(() => buildMusicComposeRequest("   ", 40_000)).toThrow();
  });
});

describe("MOOD_PROMPTS", () => {
  it("has an instrumental, no-vocals prompt for every mood", () => {
    for (const mood of ["upbeat", "warm", "celebratory", "cinematic", "neutral"] as const) {
      expect(MOOD_PROMPTS[mood]).toBeTruthy();
      expect(MOOD_PROMPTS[mood].toLowerCase()).toContain("no vocals");
    }
  });
});
