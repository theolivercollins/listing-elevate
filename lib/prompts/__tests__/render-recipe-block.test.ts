import { describe, it, expect } from "vitest";
import { renderRecipeBlock } from "../../prompt-lab.js";

const mkRecipe = (overrides: Partial<{
  id: string;
  archetype: string;
  room_type: string;
  camera_movement: string;
  provider: string | null;
  model_used: string | null;
  prompt_template: string;
  composition_signature: Record<string, unknown> | null;
  times_applied: number;
  distance: number;
}> = {}) => ({
  id: "r-default",
  archetype: "default_arch",
  room_type: "kitchen",
  camera_movement: "push_in",
  provider: null,
  model_used: "kling-v2-native",
  prompt_template: "slow cinematic push in toward the rectangular island",
  composition_signature: null,
  times_applied: 4,
  distance: 0.15,
  ...overrides,
});

describe("renderRecipeBlock — top-K rendering", () => {
  it("returns empty string when no recipes", () => {
    expect(renderRecipeBlock([])).toBe("");
  });

  it("renders 3 recipes with similarity scores (1 - distance)", () => {
    const recipes = [
      mkRecipe({
        id: "r1",
        archetype: "kitchen_dolly_island",
        camera_movement: "dolly_left_to_right",
        prompt_template: "smooth cinematic dolly right across the rectangular island",
        times_applied: 8,
        distance: 0.07,
      }),
      mkRecipe({
        id: "r2",
        archetype: "kitchen_push_island",
        camera_movement: "push_in",
        prompt_template: "slow cinematic push in toward the rectangular island",
        times_applied: 5,
        distance: 0.14,
      }),
      mkRecipe({
        id: "r3",
        archetype: "kitchen_reveal_corner",
        camera_movement: "reveal",
        model_used: "kling-v2-pro",
        prompt_template:
          "smooth cinematic reveal past the kitchen island corner to the appliance wall",
        times_applied: 3,
        distance: 0.22,
      }),
    ];
    const out = renderRecipeBlock(recipes);
    expect(out).toContain("VALIDATED RECIPE MATCHES");
    expect(out).toContain("kitchen_dolly_island");
    expect(out).toContain("kitchen_push_island");
    expect(out).toContain("kitchen_reveal_corner");
    // Similarity = round((1 - distance) * 100)
    expect(out).toContain("93%"); // 1 - 0.07
    expect(out).toContain("86%"); // 1 - 0.14
    expect(out).toContain("78%"); // 1 - 0.22
  });

  it("renders only top-K (default 3) when given more recipes", () => {
    const recipes = [1, 2, 3, 4, 5].map((i) =>
      mkRecipe({
        id: `r${i}`,
        archetype: `arch_${i}`,
        prompt_template: `template_${i}`,
        distance: i * 0.05,
      }),
    );
    const out = renderRecipeBlock(recipes);
    expect(out).toContain("arch_1");
    expect(out).toContain("arch_2");
    expect(out).toContain("arch_3");
    expect(out).not.toContain("arch_4");
    expect(out).not.toContain("arch_5");
  });

  it("renders only 1 recipe when only 1 is provided", () => {
    const out = renderRecipeBlock([
      mkRecipe({
        archetype: "solo_arch",
        prompt_template: "slow cinematic push in toward the bed",
        distance: 0.1,
      }),
    ]);
    expect(out).toContain("solo_arch");
    expect(out).toContain("VALIDATED RECIPE MATCHES");
    expect(out).toContain("90%"); // 1 - 0.1
  });

  it("respects opts.maxK override", () => {
    const recipes = [1, 2, 3].map((i) =>
      mkRecipe({ archetype: `arch_${i}`, distance: i * 0.05 }),
    );
    const out = renderRecipeBlock(recipes, { maxK: 1 });
    expect(out).toContain("arch_1");
    expect(out).not.toContain("arch_2");
    expect(out).not.toContain("arch_3");
  });

  it("falls back to provider when model_used is null", () => {
    const out = renderRecipeBlock([
      mkRecipe({
        archetype: "provider_fallback",
        model_used: null,
        provider: "kling",
        distance: 0.1,
      }),
    ]);
    expect(out).toContain("kling");
  });
});
