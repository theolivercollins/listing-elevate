import { describe, it, expect } from "vitest";
import { moodForPackage } from "./music.js";

describe("moodForPackage", () => {
  it("maps just_listed to upbeat", () => {
    expect(moodForPackage("just_listed")).toBe("upbeat");
  });
  it("maps just_pended to cinematic", () => {
    expect(moodForPackage("just_pended")).toBe("cinematic");
  });
  it("maps just_closed to celebratory", () => {
    expect(moodForPackage("just_closed")).toBe("celebratory");
  });
  it("maps life_cycle to warm", () => {
    expect(moodForPackage("life_cycle")).toBe("warm");
  });
  it("falls back to neutral for null", () => {
    expect(moodForPackage(null)).toBe("neutral");
  });
  it("falls back to neutral for unknown packages", () => {
    expect(moodForPackage("some_future_tier")).toBe("neutral");
  });
});
