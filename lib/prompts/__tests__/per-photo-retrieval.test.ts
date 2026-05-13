import { describe, it, expect } from "vitest";
import { filterRecipesByMotionHeadroom } from "../per-photo-retrieval.js";

const mk = (movement: string, archetype = `arch_${movement}`) => ({
  id: `r_${archetype}`,
  archetype,
  room_type: "living_room",
  camera_movement: movement,
  provider: null,
  model_used: null,
  prompt_template: `template for ${movement}`,
  composition_signature: null,
  times_applied: 4,
  distance: 0.15,
});

describe("filterRecipesByMotionHeadroom", () => {
  it("returns all recipes unchanged when headroom is null (Claude-fallback photo)", () => {
    const recipes = [mk("push_in"), mk("orbit"), mk("parallax")];
    const out = filterRecipesByMotionHeadroom(recipes, null);
    expect(out).toHaveLength(3);
  });

  it("drops recipes whose movement maps to a headroom=false key", () => {
    const recipes = [mk("push_in"), mk("orbit"), mk("parallax")];
    const out = filterRecipesByMotionHeadroom(recipes, {
      push_in: true,
      pull_out: false,
      orbit: false,
      parallax: true,
      drone_push_in: false,
      top_down: false,
    });
    expect(out.map((r) => r.camera_movement)).toEqual(["push_in", "parallax"]);
  });

  it("keeps recipes whose movement requires no headroom (feature_closeup, rack_focus)", () => {
    const recipes = [mk("feature_closeup"), mk("rack_focus"), mk("orbit")];
    const out = filterRecipesByMotionHeadroom(recipes, {
      push_in: false,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(out.map((r) => r.camera_movement)).toEqual([
      "feature_closeup",
      "rack_focus",
    ]);
  });

  it("treats dolly_left_to_right and dolly_right_to_left as requiring parallax headroom", () => {
    const recipes = [mk("dolly_left_to_right"), mk("dolly_right_to_left")];
    const out = filterRecipesByMotionHeadroom(recipes, {
      push_in: true,
      pull_out: true,
      orbit: true,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(out).toHaveLength(0);
  });

  it("treats drone_push_in as requiring BOTH push_in AND drone_push_in headroom", () => {
    const recipes = [mk("drone_push_in")];
    const outBothTrue = filterRecipesByMotionHeadroom(recipes, {
      push_in: true,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: true,
      top_down: false,
    });
    expect(outBothTrue).toHaveLength(1);

    const outOnlyPushTrue = filterRecipesByMotionHeadroom(recipes, {
      push_in: true,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(outOnlyPushTrue).toHaveLength(0);
  });

  it("treats reveal as compatible if parallax OR push_in is in headroom", () => {
    const recipes = [mk("reveal")];
    const outParallaxOnly = filterRecipesByMotionHeadroom(recipes, {
      push_in: false,
      pull_out: false,
      orbit: false,
      parallax: true,
      drone_push_in: false,
      top_down: false,
    });
    expect(outParallaxOnly).toHaveLength(1);

    const outPushOnly = filterRecipesByMotionHeadroom(recipes, {
      push_in: true,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(outPushOnly).toHaveLength(1);

    const outNeither = filterRecipesByMotionHeadroom(recipes, {
      push_in: false,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(outNeither).toHaveLength(0);
  });

  it("low_angle_glide requires push_in headroom", () => {
    const recipes = [mk("low_angle_glide")];
    expect(
      filterRecipesByMotionHeadroom(recipes, {
        push_in: true,
        pull_out: false,
        orbit: false,
        parallax: false,
        drone_push_in: false,
        top_down: false,
      }),
    ).toHaveLength(1);

    expect(
      filterRecipesByMotionHeadroom(recipes, {
        push_in: false,
        pull_out: false,
        orbit: false,
        parallax: false,
        drone_push_in: false,
        top_down: false,
      }),
    ).toHaveLength(0);
  });

  it("keeps recipe with unknown camera_movement (defer to director)", () => {
    const recipes = [mk("weird_unknown_movement")];
    const out = filterRecipesByMotionHeadroom(recipes, {
      push_in: false,
      pull_out: false,
      orbit: false,
      parallax: false,
      drone_push_in: false,
      top_down: false,
    });
    expect(out).toHaveLength(1);
  });
});
