import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTemplateId } from "./template-resolver.js";

const ENV_VARS = [
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_15",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_15_VERTICAL",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_30",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_30_VERTICAL",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_60",
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED_60_VERTICAL",
  "CREATOMATE_TEMPLATE_ID_JUST_PENDED",
  "CREATOMATE_TEMPLATE_ID_JUST_PENDED_15",
  "CREATOMATE_TEMPLATE_ID_JUST_CLOSED",
  "CREATOMATE_TEMPLATE_ID_LIFE_CYCLE",
  "CREATOMATE_TEMPLATE_ID_DEFAULT",
];

describe("resolveTemplateId", () => {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_VARS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_VARS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it("returns null when nothing is configured", () => {
    expect(resolveTemplateId({})).toBeNull();
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBeNull();
  });

  it("returns propertyTemplateId override when set", () => {
    expect(
      resolveTemplateId({ propertyTemplateId: "abc-123" }),
    ).toBe("abc-123");
  });

  it("override wins over every env var", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "env-id";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = "env-id-15";
    expect(
      resolveTemplateId({
        propertyTemplateId: "override-id",
        selectedPackage: "just_listed",
        selectedDuration: 15,
      }),
    ).toBe("override-id");
  });

  it("falls through empty propertyTemplateId to env var", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "env-id";
    expect(
      resolveTemplateId({
        propertyTemplateId: "  ",
        selectedPackage: "just_listed",
      }),
    ).toBe("env-id");
  });

  it("picks the duration-specific var when duration is set", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "legacy-id";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = "id-15";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_30 = "id-30";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_60 = "id-60";
    expect(resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 15 })).toBe("id-15");
    expect(resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 30 })).toBe("id-30");
    expect(resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 60 })).toBe("id-60");
  });

  it("returns null (not legacy) when duration is set but no duration-specific var exists", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "legacy-id";
    process.env.CREATOMATE_TEMPLATE_ID_DEFAULT = "default-id";
    expect(
      resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 30 }),
    ).toBeNull();
  });

  it("legacy un-suffixed var is honored when duration is NOT set", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "legacy-id";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("legacy-id");
  });

  it("DEFAULT fallback only fires when duration is NOT set", () => {
    process.env.CREATOMATE_TEMPLATE_ID_DEFAULT = "default-id";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("default-id");
    expect(resolveTemplateId({})).toBe("default-id");
    // With duration set + no matching duration var → null, NOT default
    expect(
      resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 30 }),
    ).toBeNull();
  });

  it("picks the right env var per package", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "id-listed";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_PENDED = "id-pended";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_CLOSED = "id-closed";
    process.env.CREATOMATE_TEMPLATE_ID_LIFE_CYCLE = "id-cycle";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("id-listed");
    expect(resolveTemplateId({ selectedPackage: "just_pended" })).toBe("id-pended");
    expect(resolveTemplateId({ selectedPackage: "just_closed" })).toBe("id-closed");
    expect(resolveTemplateId({ selectedPackage: "life_cycle" })).toBe("id-cycle");
  });

  it("trims whitespace from env vars", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = "  trimmed-id-15  \n";
    expect(
      resolveTemplateId({ selectedPackage: "just_listed", selectedDuration: 15 }),
    ).toBe("trimmed-id-15");
  });

  it("picks the _VERTICAL suffix when aspectRatio is 9:16", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = "id-15-h";
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15_VERTICAL = "id-15-v";
    expect(
      resolveTemplateId({
        selectedPackage: "just_listed",
        selectedDuration: 15,
        aspectRatio: "9:16",
      }),
    ).toBe("id-15-v");
    // And the horizontal lookup still returns the horizontal var
    expect(
      resolveTemplateId({
        selectedPackage: "just_listed",
        selectedDuration: 15,
        aspectRatio: "16:9",
      }),
    ).toBe("id-15-h");
  });

  it("returns null for 9:16 when no _VERTICAL template exists, even if horizontal is configured", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = "id-15-h";
    expect(
      resolveTemplateId({
        selectedPackage: "just_listed",
        selectedDuration: 15,
        aspectRatio: "9:16",
      }),
    ).toBeNull();
  });

  it("9:16 + legacy un-suffixed var → null (vertical never reuses horizontal legacy)", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "legacy-id";
    process.env.CREATOMATE_TEMPLATE_ID_DEFAULT = "default-id";
    expect(
      resolveTemplateId({ selectedPackage: "just_listed", aspectRatio: "9:16" }),
    ).toBeNull();
  });

  it("propertyTemplateId override wins for 9:16 too", () => {
    expect(
      resolveTemplateId({
        propertyTemplateId: "vert-override",
        selectedPackage: "just_listed",
        selectedDuration: 15,
        aspectRatio: "9:16",
      }),
    ).toBe("vert-override");
  });
});
