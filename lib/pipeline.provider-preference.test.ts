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
