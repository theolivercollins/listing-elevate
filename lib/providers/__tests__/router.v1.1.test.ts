import { describe, it, expect } from "vitest";
import {
  selectProviderForScene,
  forceSeedancePushInPrompt,
  resolveRenderPrompt,
  stripMovementVerbs,
  V1_DEFAULT_SKU,
  getEnabledProviders,
} from "../router.js";
import { ATLAS_MODELS } from "../atlas.js";
import type { RoomType, CameraMovement } from "../../types.js";

const baseScene = {
  endPhotoId: null as string | null,
  movement: "push_in" as CameraMovement,
  roomType: "living_room" as RoomType,
  preference: null,
};

describe("selectProviderForScene — v1.1 mode", () => {
  it("routes unpaired scenes to atlas+seedance-pro-pushin when mode='v1.1'", () => {
    const decision = selectProviderForScene(baseScene, [], "v1.1");
    expect(decision.provider).toBe("atlas");
    expect(decision.modelKey).toBe("seedance-pro-pushin");
  });

  it("seedance Atlas SKU is registered in ATLAS_MODELS", () => {
    expect(ATLAS_MODELS["seedance-pro-pushin"]).toBeDefined();
    expect(ATLAS_MODELS["seedance-pro-pushin"].endFrameField).toBeNull();
  });

  it("v1.1 decision has an Atlas v1 fallback", () => {
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

  it("v1 mode does not route to the Seedance SKU", () => {
    const decision = selectProviderForScene(baseScene, [], "v1");
    expect(decision.modelKey).not.toBe("seedance-pro-pushin");
  });

  it("default mode (no arg) is v1 — does not route to Seedance SKU", () => {
    const decision = selectProviderForScene(baseScene, []);
    expect(decision.modelKey).not.toBe("seedance-pro-pushin");
  });

  it("skips v1.1 path when atlas is already excluded (mid-failover)", () => {
    const decision = selectProviderForScene(baseScene, ["atlas"], "v1.1");
    expect(decision.modelKey).not.toBe("seedance-pro-pushin");
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

describe("resolveRenderPrompt — v1.1 push-in safety on any provider", () => {
  const mixed = "smooth cinematic parallax glide past the granite breakfast bar.";

  it("forces push-in under v1.1 even when the provider is NOT the Seedance SKU (failover to Kling)", () => {
    // modelKey undefined = native Kling failover. The 310 Severin clip-3 bug:
    // Kling used to receive the raw 'parallax glide' prompt and hallucinated.
    const out = resolveRenderPrompt("v1.1", undefined, mixed);
    expect(out.startsWith("Slow, steady push in toward the room.")).toBe(true);
    expect(out.toLowerCase()).not.toMatch(/parallax glide/);
  });

  it("forces push-in under v1.1 for the Seedance SKU too", () => {
    const out = resolveRenderPrompt("v1.1", "seedance-pro-pushin", mixed);
    expect(out.startsWith("Slow, steady push in toward the room.")).toBe(true);
  });

  it("still forces push-in for the Seedance SKU even under v1 (SKU-level safety)", () => {
    const out = resolveRenderPrompt("v1", "seedance-pro-pushin", mixed);
    expect(out.startsWith("Slow, steady push in toward the room.")).toBe(true);
  });

  it("leaves the prompt untouched under v1 with a non-Seedance provider", () => {
    expect(resolveRenderPrompt("v1", undefined, mixed)).toBe(mixed);
    expect(resolveRenderPrompt(null, "kling-v2-master", mixed)).toBe(mixed);
  });
});

describe("stripMovementVerbs (regex sanity)", () => {
  it("removes 'slowly orbit' phrasing entirely", () => {
    const out = stripMovementVerbs("Slowly orbit the dining table. Keep the chandelier centered.");
    expect(out.toLowerCase()).not.toContain("orbit");
    expect(out).toContain("chandelier");
  });
});

describe("getEnabledProviders — v1.1 needs atlas", () => {
  it("v1.1 piggy-backs on Atlas; no Seedance-specific env gate", () => {
    // Seedance is routed via Atlas, so the only credential v1.1 needs is the
    // Atlas key. We don't assert atlas is present in CI; we just assert that
    // there is no longer a Seedance-specific entry leaking through.
    const enabled = getEnabledProviders();
    expect(enabled).not.toContain("seedance" as never);
  });
});
