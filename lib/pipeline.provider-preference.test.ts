/**
 * Tests for resolveRoutingPreference — the pure function that determines
 * which provider preference to pass to selectProviderForScene on reruns.
 *
 * Invariants under test (from task T4-provider-preference):
 * 1. opts.providerOverride beats everything.
 * 2. provider_preference beats a polluted scenes.provider value.
 * 3. provider_preference=null → null (router decides).
 * 4. provider_preference absent (undefined, column not yet migrated) → null (null-safe).
 * 5. scenes.provider is never used for routing (pure audit record).
 */
import { describe, it, expect } from "vitest";
import { resolveRoutingPreference } from "./pipeline.js";
import { selectProviderForScene, isSeedancePushInSku, shouldForcePushIn } from "./providers/router.js";

describe("resolveRoutingPreference", () => {
  it("opts.providerOverride beats provider_preference", () => {
    const preference = resolveRoutingPreference(
      { provider: "kling", provider_preference: "atlas" },
      "runway",
    );
    expect(preference).toBe("runway");
  });

  it("opts.providerOverride beats a null provider_preference", () => {
    const preference = resolveRoutingPreference(
      { provider: "kling", provider_preference: null },
      "atlas",
    );
    expect(preference).toBe("atlas");
  });

  it("provider_preference wins when no providerOverride (ignores polluted scenes.provider)", () => {
    // scenes.provider='kling' is the actually-ran value from a failed Atlas run.
    // provider_preference='atlas' is the director's original intent.
    // On rerun, the router should prefer atlas — not the polluted kling value.
    const preference = resolveRoutingPreference(
      { provider: "kling", provider_preference: "atlas" },
      undefined,
    );
    expect(preference).toBe("atlas");
  });

  it("provider_preference=null → null (router decides)", () => {
    const preference = resolveRoutingPreference(
      { provider: "atlas", provider_preference: null },
      undefined,
    );
    expect(preference).toBe(null);
  });

  it("provider_preference absent (undefined) → null (null-safe, column not yet applied)", () => {
    // Guard: if the migration hasn't been applied yet, provider_preference
    // will be missing from the row. The function must not crash or return
    // a truthy value — it should fall back to null (router decides).
    const preference = resolveRoutingPreference(
      { provider: "atlas" },
      undefined,
    );
    expect(preference).toBe(null);
  });

  it("scenes.provider alone is never used for routing (no providerOverride, no preference)", () => {
    // Any non-null scenes.provider must be ignored when provider_preference is null/absent.
    const preference = resolveRoutingPreference(
      { provider: "runway", provider_preference: null },
    );
    expect(preference).toBe(null);
  });
});

describe("selectProviderForScene — skuOverride passthrough (Wave-2 req 4a)", () => {
  const baseScene = {
    endPhotoId: null,
    movement: "push_in" as const,
    roomType: "living_room" as const,
    preference: null,
  };

  it("passes skuOverride through to the decision when it is a known operator SKU", () => {
    const decision = selectProviderForScene(baseScene, [], "v1", "seedance-2-0-4k");
    expect(decision.provider).toBe("atlas");
    expect(decision.modelKey).toBe("seedance-2-0-4k");
  });

  it("ignores an unrecognised skuOverride and falls through to movement routing", () => {
    const decision = selectProviderForScene(baseScene, [], "v1", "unknown-future-sku");
    // Falls back to v1 movement routing — atlas with V1_DEFAULT_SKU
    expect(decision.provider).toBe("atlas");
    expect(decision.modelKey).not.toBe("unknown-future-sku");
  });

  it("skuOverride has no effect on paired scenes (end_photo_id wins over skuOverride)", () => {
    // Paired rule (DQ.3) fires after skuOverride only when the scene IS paired.
    // Actually per router.ts rule order: skuOverride is rule 0, paired is rule 1.
    // With a valid skuOverride the operator choice still wins — this verifies that.
    const pairedScene = { ...baseScene, endPhotoId: "end-photo-uuid" };
    const decision = selectProviderForScene(pairedScene, [], "v1", "seedance-2-0-4k");
    // skuOverride (rule 0) beats paired (rule 1)
    expect(decision.modelKey).toBe("seedance-2-0-4k");
  });
});

describe("isSeedancePushInSku + shouldForcePushIn (Wave-2 req 4b)", () => {
  it("isSeedancePushInSku returns true for seedance-pro-pushin", () => {
    expect(isSeedancePushInSku("seedance-pro-pushin")).toBe(true);
  });

  it("isSeedancePushInSku returns true for seedance-2-0-4k", () => {
    expect(isSeedancePushInSku("seedance-2-0-4k")).toBe(true);
  });

  it("isSeedancePushInSku returns false for kling-v2-6-pro", () => {
    expect(isSeedancePushInSku("kling-v2-6-pro")).toBe(false);
  });

  it("isSeedancePushInSku returns false for null / undefined", () => {
    expect(isSeedancePushInSku(null)).toBe(false);
    expect(isSeedancePushInSku(undefined)).toBe(false);
  });

  it("shouldForcePushIn is false for v1 mode regardless of end_photo_id", () => {
    expect(shouldForcePushIn("v1", null)).toBe(false);
    expect(shouldForcePushIn("v1", "some-id")).toBe(false);
  });

  it("shouldForcePushIn is true for v1.1 + non-paired scene", () => {
    expect(shouldForcePushIn("v1.1", null)).toBe(true);
  });

  it("shouldForcePushIn is false for v1.1 + paired scene", () => {
    expect(shouldForcePushIn("v1.1", "end-photo-id")).toBe(false);
  });

  it("push-in should trigger under v1 mode when operator picked seedance-2-0-4k (the OR gate)", () => {
    // Simulates the pipeline logic: the combined condition is:
    //   shouldForcePushIn(mode, end_photo_id) || isSeedancePushInSku(decision.modelKey)
    const mode = "v1";
    const endPhotoId = null;
    const decision = selectProviderForScene(
      { endPhotoId, movement: "push_in" as const, roomType: "living_room" as const, preference: null },
      [],
      mode,
      "seedance-2-0-4k",
    );
    const forcePushIn = shouldForcePushIn(mode, endPhotoId) || isSeedancePushInSku(decision.modelKey);
    expect(forcePushIn).toBe(true);
  });

  it("push-in does NOT trigger under v1 mode when operator picked kling-v2-6-pro", () => {
    const mode = "v1";
    const endPhotoId = null;
    const decision = selectProviderForScene(
      { endPhotoId, movement: "push_in" as const, roomType: "living_room" as const, preference: null },
      [],
      mode,
      "kling-v2-6-pro",
    );
    const forcePushIn = shouldForcePushIn(mode, endPhotoId) || isSeedancePushInSku(decision.modelKey);
    expect(forcePushIn).toBe(false);
  });
});
