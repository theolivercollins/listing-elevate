import { describe, it, expect } from "vitest";
import {
  selectProviderForScene,
  forceSeedancePushInPrompt,
  stripMovementVerbs,
  stripFocalFixation,
  shouldForcePushIn,
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

  it("paired scenes ALWAYS route to kling-v3-pro even under v1.1", () => {
    const paired = { ...baseScene, endPhotoId: "photo-end-id" };
    const decision = selectProviderForScene(paired, [], "v1.1");
    expect(decision.provider).toBe("atlas");
    expect(decision.modelKey).toBe("kling-v3-pro");
  });

  it("the paired SKU (kling-v3-pro) declares end_image support in ATLAS_MODELS", () => {
    expect(ATLAS_MODELS["kling-v3-pro"].endFrameField).toBe("end_image");
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

describe("RULE DQ.3 default vs seedance-pair (opt-in only)", () => {
  it("paired scenes still DEFAULT to kling-v3-pro in every mode — never seedance-pair", () => {
    const paired = { ...baseScene, endPhotoId: "photo-end-id" };
    for (const mode of ["v1", "v1.1"] as const) {
      const decision = selectProviderForScene(paired, [], mode);
      expect(decision.provider).toBe("atlas");
      expect(decision.modelKey).toBe("kling-v3-pro");
      expect(decision.modelKey).not.toBe("seedance-pair");
      expect(decision.fallback).toBeUndefined();
    }
    // Default mode arg too.
    expect(selectProviderForScene(paired, []).modelKey).toBe("kling-v3-pro");
  });

  it("seedance-pair is registered with last_image end-frame support (explicit choices only)", () => {
    expect(ATLAS_MODELS["seedance-pair"]).toBeDefined();
    expect(ATLAS_MODELS["seedance-pair"].endFrameField).toBe("last_image");
  });

  it("the push-in SKU keeps endFrameField null — the preamble-keyed SKU never sends an end frame", () => {
    expect(ATLAS_MODELS["seedance-pro-pushin"].endFrameField).toBeNull();
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

// ─── STRIP MATRIX (the safety net) ───────────────────────────────────────────
//
// This is the regression net the P0 slipped through last time: the old tests
// only asserted the optical keyword was GONE, never that the director's subject
// noun SURVIVED. The macro/bokeh whole-clause regex deleted the subject and
// still passed. Every case below pins BOTH directions.
//
// Two distinct contracts, enforced separately:
//   • OPTICAL framing (DoF / close-up / focused-on / macro / bokeh) is a
//     modifier on a director-chosen subject → strip the optical word SURGICALLY,
//     KEEP the subject noun.
//   • CAMERA MOVEMENT (orbit / drone / aerial / glide / parallax / …) is a
//     camera path → remove the whole movement clause. Dropping the subject too
//     is the ACCEPTED, DELIBERATE behavior — the source photo re-establishes the
//     subject and the preamble supplies the push-in.

describe("forceSeedancePushInPrompt — OPTICAL strip keeps the subject noun", () => {
  it("DoF: keeps the vanity fixture, drops depth-of-field + blurred", () => {
    const out = forceSeedancePushInPrompt(
      "cinematic slow push in with shallow depth of field on the five-light glass vanity fixture, background softly blurred",
    );
    expect(out).toMatch(/vanity fixture/i);
    expect(out).not.toMatch(/depth of field/i);
    expect(out).not.toMatch(/blurred/i);
  });

  it("close-up: keeps the marble countertop, drops close-up", () => {
    const out = forceSeedancePushInPrompt("extreme close-up of the marble countertop");
    expect(out).toMatch(/marble countertop/i);
    expect(out).not.toMatch(/close-?up/i);
  });

  it("focused-on: keeps the brass faucet, drops focus", () => {
    const out = forceSeedancePushInPrompt("focused on the brass faucet");
    expect(out).toMatch(/brass faucet/i);
    expect(out).not.toMatch(/focus/i);
  });

  it("macro: keeps faucet AND basin, drops macro (P0 regression — was preamble-only)", () => {
    const out = forceSeedancePushInPrompt(
      "Macro push toward the brushed-gold faucet, water beading on the basin",
    );
    expect(out).toMatch(/faucet/i);
    expect(out).toMatch(/basin/i);
    expect(out).not.toMatch(/macro/i);
  });

  it("bokeh: keeps wine fridge AND under-cabinet lights, drops bokeh + close-up (P0 — was 'Cinematic the wine fridge,')", () => {
    const out = forceSeedancePushInPrompt(
      "Cinematic close-up of the wine fridge, bokeh from the under-cabinet lights",
    );
    expect(out).toMatch(/wine fridge/i);
    expect(out).toMatch(/under-cabinet lights/i);
    expect(out).not.toMatch(/bokeh/i);
    expect(out).not.toMatch(/close-?up/i);
    // P2 cleanup: no orphan "Cinematic" article-head, no dangling trailing comma.
    expect(out).not.toMatch(/Cinematic the/i);
    expect(out).not.toMatch(/,\s*$/);
  });
});

describe("forceSeedancePushInPrompt — MOVEMENT strip removes the movement word (subject-drop is deliberate)", () => {
  // The preamble intentionally enumerates "No tilt, no rotation, no parallax,
  // no orbit." — so for movement words that ALSO appear in the preamble (orbit,
  // parallax) we must assert against the SUFFIX (subject text after the
  // preamble), matching the established pattern above. Movement words absent
  // from the preamble (drone, aerial, glide, descend, tracking) are safe to
  // assert against the full output.
  const PREAMBLE =
    "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.";
  const suffixOf = (out: string) => (out.startsWith(PREAMBLE) ? out.slice(PREAMBLE.length) : out);

  it("drone: removes the drone clause, preamble push-in present", () => {
    const out = forceSeedancePushInPrompt("drone flying forward over the front of the house");
    expect(out).toMatch(/push in/i);
    expect(out).not.toMatch(/drone/i);
  });

  it("aerial: removes aerial + sweep", () => {
    const out = forceSeedancePushInPrompt("aerial view sweeping over the backyard");
    expect(out).not.toMatch(/aerial/i);
    expect(out).not.toMatch(/sweep/i);
  });

  it("glide: removes gliding", () => {
    const out = forceSeedancePushInPrompt("gliding past the staircase");
    expect(out).not.toMatch(/glid/i);
  });

  it("descend: removes the descend clause", () => {
    const out = forceSeedancePushInPrompt("Drone descends toward the front entry");
    expect(out).not.toMatch(/descend/i);
    expect(out).not.toMatch(/drone/i);
  });

  it("tracking: removes the tracking clause", () => {
    const out = forceSeedancePushInPrompt("tracking shot moving forward through the hallway");
    expect(out).not.toMatch(/tracking/i);
  });

  it("parallax+glide combined: removes both (subject 'kitchen island' is DELIBERATELY dropped — movement clause-nuke)", () => {
    // "parallax" appears in the preamble, so assert against the suffix only.
    const suffix = suffixOf(forceSeedancePushInPrompt("parallax glide past the kitchen island"));
    expect(suffix).not.toMatch(/parallax/i);
    expect(suffix).not.toMatch(/glid/i);
  });

  it("orbit: removes the orbit clause", () => {
    // "orbit" appears in the preamble, so assert against the suffix only.
    const suffix = suffixOf(forceSeedancePushInPrompt("slow orbit around the living room"));
    expect(suffix).not.toMatch(/orbit/i);
  });
});

describe("stripMovementVerbs (regex sanity)", () => {
  it("removes 'slowly orbit' phrasing entirely", () => {
    const out = stripMovementVerbs("Slowly orbit the dining table. Keep the chandelier centered.");
    expect(out.toLowerCase()).not.toContain("orbit");
    expect(out).toContain("chandelier");
  });
});

describe("stripFocalFixation", () => {
  it("removes 'shallow depth of field'", () => {
    const out = stripFocalFixation("cinematic slow push in with shallow depth of field on the vanity fixture, background softly blurred");
    expect(out.toLowerCase()).not.toMatch(/shallow depth of field/);
  });

  it("removes 'background softly blurred'", () => {
    const out = stripFocalFixation("A wide shot, background softly blurred.");
    expect(out.toLowerCase()).not.toMatch(/background.*blurred|blurred background/);
  });

  it("removes 'background blurred'", () => {
    const out = stripFocalFixation("The kitchen, background blurred.");
    expect(out.toLowerCase()).not.toMatch(/background.*blurred/);
  });

  it("removes 'close-up'", () => {
    const out = stripFocalFixation("Extreme close-up of the faucet. The marble is beautiful.");
    expect(out.toLowerCase()).not.toMatch(/close-?up/);
    expect(out).toContain("marble");
  });

  it("removes 'bokeh'", () => {
    const out = stripFocalFixation("Soft bokeh surrounds the pendant light.");
    expect(out.toLowerCase()).not.toContain("bokeh");
  });

  it("removes 'focused on the X' phrase", () => {
    const out = stripFocalFixation("Camera focused on the chandelier above.");
    expect(out.toLowerCase()).not.toMatch(/focused on the/);
  });

  it("preserves subject nouns (does not nuke the whole sentence)", () => {
    const out = stripFocalFixation("cinematic slow push in with shallow depth of field on the five-light glass vanity fixture, background softly blurred");
    // Subject words like 'vanity' should survive
    expect(out.toLowerCase()).toMatch(/vanity|fixture/);
  });

  // ── Positive subject-retention assertions ────────────────────────────────
  // A future regex change that strips DoF by consuming the rest of the
  // clause would delete the subject noun and cause these to fail, catching
  // the regression before it ships.

  it("keeps the subject noun after 'shallow depth of field on the X'", () => {
    const out = stripFocalFixation("with shallow depth of field on the marble island in the kitchen");
    expect(out.toLowerCase()).not.toMatch(/shallow depth of field/);
    // "marble island" must survive — it's the subject, not the optical framing.
    expect(out.toLowerCase()).toMatch(/marble island/);
  });

  it("keeps the subject noun after 'focus on the X' (multi-word subject)", () => {
    const out = stripFocalFixation("Tight shot focused on the kitchen sink, showing the farmhouse basin.");
    expect(out.toLowerCase()).not.toMatch(/focused on the/);
    // "kitchen sink" is the subject and must survive.
    expect(out.toLowerCase()).toMatch(/kitchen sink/);
  });

  it("keeps the subject noun after 'close-up of the X' while stripping the close-up prefix", () => {
    const out = stripFocalFixation("Extreme close-up of the faucet handle, water droplets visible.");
    expect(out.toLowerCase()).not.toMatch(/close-?up/);
    expect(out.toLowerCase()).toMatch(/faucet/);
  });

  it("strips focal-fixation at a semicolon boundary without eating the next clause", () => {
    // Semicolons are clause separators; what comes after must survive intact.
    const out = stripFocalFixation("shallow depth of field; warm afternoon light fills the room");
    expect(out.toLowerCase()).not.toMatch(/shallow depth of field/);
    expect(out.toLowerCase()).toMatch(/warm afternoon light/);
  });
});

describe("forceSeedancePushInPrompt — scene-6 regression", () => {
  const PREAMBLE =
    "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.";

  it("strips shallow-DoF + background-blurred from a feature_closeup prompt", () => {
    const input =
      "cinematic slow push in with shallow depth of field on the five-light glass vanity fixture, background softly blurred";
    const out = forceSeedancePushInPrompt(input);
    expect(out.startsWith(PREAMBLE)).toBe(true);
    expect(out.toLowerCase()).not.toMatch(/shallow depth of field/);
    expect(out.toLowerCase()).not.toMatch(/background.*blurred|blurred background/);
    // Positive: the subject noun must survive — the whole-clause deletion bug
    // produced "cinematic slow push in" with the vanity gone entirely.
    expect(out.toLowerCase()).toMatch(/vanity|fixture/);
  });

  it("the push-in preamble is present after stripping", () => {
    const input =
      "cinematic slow push in with shallow depth of field on the five-light glass vanity fixture, background softly blurred";
    const out = forceSeedancePushInPrompt(input);
    expect(out).toContain("Slow, steady push in toward the room.");
  });

  it("retains subject noun after stripping focal-fixation", () => {
    const input =
      "shallow depth of field on the five-light glass vanity fixture, background softly blurred";
    const out = forceSeedancePushInPrompt(input);
    expect(out.toLowerCase()).toMatch(/vanity|fixture/);
  });
});

describe("shouldForcePushIn", () => {
  it("returns true for v1.1 non-paired scene", () => {
    expect(shouldForcePushIn("v1.1", null)).toBe(true);
    expect(shouldForcePushIn("v1.1", undefined)).toBe(true);
  });

  it("returns false for v1.1 paired scene (end_photo_id set)", () => {
    expect(shouldForcePushIn("v1.1", "some-photo-id")).toBe(false);
  });

  it("returns false for v1 non-paired scene", () => {
    expect(shouldForcePushIn("v1", null)).toBe(false);
  });

  it("returns false for empty string pipeline mode", () => {
    expect(shouldForcePushIn("", null)).toBe(false);
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
