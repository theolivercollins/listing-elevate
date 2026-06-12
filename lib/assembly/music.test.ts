import { describe, it, expect } from "vitest";
import { moodForPackage, pickRandom } from "./music.js";

describe("pickRandom", () => {
  it("returns null on an empty pool", () => {
    expect(pickRandom([])).toBeNull();
  });
  it("returns the only element", () => {
    expect(pickRandom(["a"])).toBe("a");
  });
  it("uses the injected rng to index the pool", () => {
    const pool = ["a", "b", "c", "d"];
    expect(pickRandom(pool, () => 0)).toBe("a");
    expect(pickRandom(pool, () => 0.5)).toBe("c");
    expect(pickRandom(pool, () => 0.999)).toBe("d");
  });
});

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
