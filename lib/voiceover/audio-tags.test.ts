import { describe, it, expect } from "vitest";
import { stripAudioTags, REAL_ESTATE_AUDIO_TAGS } from "./audio-tags.js";

describe("stripAudioTags", () => {
  it("removes a leading tag and tidies whitespace", () => {
    expect(stripAudioTags("[warmly] Welcome to 42 Maple Street.")).toBe(
      "Welcome to 42 Maple Street.",
    );
  });

  it("removes mid-sentence tags without leaving double spaces", () => {
    expect(
      stripAudioTags("A stunning home [pause] with a pool and a view."),
    ).toBe("A stunning home with a pool and a view.");
  });

  it("does not leave a space before punctuation", () => {
    expect(stripAudioTags("Truly exceptional [softly].")).toBe(
      "Truly exceptional.",
    );
  });

  it("strips every real-estate tag we instruct the writer to use", () => {
    const tagged = REAL_ESTATE_AUDIO_TAGS.map((t) => `${t} word`).join(" ");
    const stripped = stripAudioTags(tagged);
    for (const tag of REAL_ESTATE_AUDIO_TAGS) {
      expect(stripped).not.toContain(tag);
    }
    expect(stripped).toBe("word word word word word word");
  });

  it("leaves untagged text unchanged", () => {
    const clean = "Welcome home. This is the one.";
    expect(stripAudioTags(clean)).toBe(clean);
  });

  it("does not eat long bracketed prose (over 30 chars)", () => {
    const text = "See note [this is a very long editorial aside indeed here].";
    expect(stripAudioTags(text)).toBe(text);
  });
});
