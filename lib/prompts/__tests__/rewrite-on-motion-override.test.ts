import { describe, it, expect } from "vitest";
import { rewritePromptForNewMotion } from "../rewrite-on-motion-override.js";

describe("rewritePromptForNewMotion", () => {
  it("replaces low_angle_glide with feature_closeup template, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "steady cinematic low angle glide toward the fireplace flanked by built-in shelving",
      "feature_closeup",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the fireplace flanked by built-in shelving, background softly blurred",
    );
  });

  it("replaces push_in with low_angle_glide phrasing, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "slow cinematic push in toward the waterfall granite island",
      "low_angle_glide",
    );
    expect(result).toBe(
      "steady cinematic low angle glide toward the waterfall granite island",
    );
  });

  it("replaces dolly_right with orbit, preserving subject", () => {
    const result = rewritePromptForNewMotion(
      "smooth cinematic dolly right across the bank of cabinets against the left-back wall",
      "orbit",
    );
    expect(result).toBe(
      "smooth cinematic orbit around the bank of cabinets against the left-back wall",
    );
  });

  it("falls back to subjectFallback when subject can't be extracted", () => {
    const result = rewritePromptForNewMotion(
      "weirdly malformed prompt without canonical pattern",
      "feature_closeup",
      "the freestanding tub",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the freestanding tub, background softly blurred",
    );
  });

  it("falls back to a generic safe template when subject extraction fails AND no fallback given", () => {
    const result = rewritePromptForNewMotion(
      "weirdly malformed prompt without canonical pattern",
      "feature_closeup",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the focal subject, background softly blurred",
    );
  });

  it("returns the original prompt unchanged when newMotion is unknown (no-op safety)", () => {
    const original = "slow cinematic push in toward the bed";
    const result = rewritePromptForNewMotion(original, "unknown_motion");
    expect(result).toBe(original);
  });

  it("rewrites top_down preserving subject from drone prompt", () => {
    const result = rewritePromptForNewMotion(
      "smooth cinematic drone flying forward at rooftop height toward the front facade",
      "top_down",
    );
    expect(result).toBe("smooth cinematic top down of the front facade");
  });

  it("rewrites reveal preserving subject (uses 'past' construction)", () => {
    const result = rewritePromptForNewMotion(
      "slow cinematic push in toward the kitchen island corner",
      "reveal",
    );
    expect(result).toBe(
      "smooth cinematic reveal past the kitchen island corner",
    );
  });

  it("strips trailing 'and X beyond' clause from extracted subject", () => {
    const result = rewritePromptForNewMotion(
      "smooth cinematic parallax glide past the raised planting bed toward the rectangular dock and canal beyond",
      "feature_closeup",
    );
    expect(result).toBe(
      "cinematic slow push in with shallow depth of field on the rectangular dock, background softly blurred",
    );
  });
});
