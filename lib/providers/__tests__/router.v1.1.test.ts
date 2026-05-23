import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  selectProviderForScene,
  forceSeedancePushInPrompt,
  stripMovementVerbs,
  V1_DEFAULT_SKU,
  getEnabledProviders,
} from "../router.js";
import type { RoomType, CameraMovement } from "../../types.js";

// Ensure Seedance constructor doesn't blow up on import paths if anyone
// flips a switch. Router itself never instantiates providers.
const ORIGINAL_REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
beforeAll(() => {
  process.env.REPLICATE_API_TOKEN = "test-token";
});
afterAll(() => {
  if (ORIGINAL_REPLICATE_TOKEN === undefined) {
    delete process.env.REPLICATE_API_TOKEN;
  } else {
    process.env.REPLICATE_API_TOKEN = ORIGINAL_REPLICATE_TOKEN;
  }
});

const baseScene = {
  endPhotoId: null as string | null,
  movement: "push_in" as CameraMovement,
  roomType: "living_room" as RoomType,
  preference: null,
};

describe("selectProviderForScene — v1.1 mode", () => {
  it("routes unpaired scenes to seedance when mode='v1.1'", () => {
    const decision = selectProviderForScene(baseScene, [], "v1.1");
    expect(decision.provider).toBe("seedance");
    expect(decision.modelKey).toBe("seedance-1-pro-pushin");
  });

  it("seedance decision has an Atlas v1 fallback", () => {
    const decision = selectProviderForScene(baseScene, [], "v1.1");
    expect(decision.fallback?.provider).toBe("atlas");
    expect(decision.fallback?.modelKey).toBe(V1_DEFAULT_SKU);
    expect(decision.fallback?.fallback).toBeUndefined();
  });

  it("paired scenes ALWAYS route to kling-v2-1-pair even under v1.1", () => {
    const paired = { ...baseScene, endPhotoId: "photo-end-id" };
    const decision = selectProviderForScene(paired, [], "v1.1");
    expect(decision.provider).toBe("atlas");
    expect(decision.modelKey).toBe("kling-v2-1-pair");
  });

  it("v1 mode does not change existing routing", () => {
    const decision = selectProviderForScene(baseScene, [], "v1");
    expect(decision.provider).not.toBe("seedance");
  });

  it("default mode (no arg) is v1 — does not route to seedance", () => {
    const decision = selectProviderForScene(baseScene, []);
    expect(decision.provider).not.toBe("seedance");
  });

  it("skips seedance when it's already excluded (mid-failover)", () => {
    const decision = selectProviderForScene(baseScene, ["seedance"], "v1.1");
    expect(decision.provider).not.toBe("seedance");
  });
});

describe("forceSeedancePushInPrompt", () => {
  it("prepends the canonical push-in directive", () => {
    const out = forceSeedancePushInPrompt("Wide angle of a sunlit kitchen.");
    expect(out.startsWith("Slow, steady push in toward the room.")).toBe(true);
  });

  it("strips orbit / rotate / parallax verbs from the subject portion", () => {
    // The preamble intentionally says "No tilt, no rotation, no parallax, no orbit"
    // — that's allowed. We only check the SUFFIX (subject text after the preamble)
    // for residual movement verbs from the original prompt.
    const PREAMBLE =
      "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.";
    const cases = [
      "Slowly orbit around the kitchen island, showcasing the marble counters.",
      "Camera rotates clockwise revealing the open layout.",
      "Subtle parallax across the living room.",
      "Pull back to reveal the full room.",
      "Tilt up from the floor to the ceiling.",
      "Pan slowly to the right across the windows.",
      "Fly through the entryway into the great room.",
    ];
    for (const input of cases) {
      const out = forceSeedancePushInPrompt(input);
      const suffix = out.startsWith(PREAMBLE) ? out.slice(PREAMBLE.length) : out;
      expect(suffix.toLowerCase()).not.toMatch(
        /\b(orbit|rotate|parallax|pull\s+back|tilt|pan|fly\s+through)\b/,
      );
    }
  });

  it("preserves non-movement subject language", () => {
    const out = forceSeedancePushInPrompt(
      "Wide angle of a sunlit kitchen with white cabinets and a marble island.",
    );
    expect(out).toContain("sunlit kitchen");
    expect(out).toContain("marble island");
  });

  it("returns just the preamble for an empty / movement-only prompt", () => {
    const out = forceSeedancePushInPrompt("orbit slowly.");
    expect(out).toBe(
      "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.",
    );
  });
});

describe("stripMovementVerbs (regex sanity)", () => {
  it("removes 'slowly orbit' phrasing entirely", () => {
    const out = stripMovementVerbs("Slowly orbit the dining table. Keep the chandelier centered.");
    expect(out.toLowerCase()).not.toContain("orbit");
    expect(out).toContain("chandelier");
  });
});

describe("getEnabledProviders — seedance gate", () => {
  it("includes 'seedance' when REPLICATE_API_TOKEN is set", () => {
    const enabled = getEnabledProviders();
    expect(enabled).toContain("seedance");
  });
});
