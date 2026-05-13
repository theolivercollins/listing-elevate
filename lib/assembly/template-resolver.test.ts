import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTemplateId } from "./template-resolver.js";

const ENV_VARS = [
  "CREATOMATE_TEMPLATE_ID_JUST_LISTED",
  "CREATOMATE_TEMPLATE_ID_JUST_PENDED",
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

  it("override wins over package env var", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "env-id";
    expect(
      resolveTemplateId({
        propertyTemplateId: "override-id",
        selectedPackage: "just_listed",
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

  it("falls back to DEFAULT when package env var is missing", () => {
    process.env.CREATOMATE_TEMPLATE_ID_DEFAULT = "default-id";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("default-id");
    expect(resolveTemplateId({})).toBe("default-id");
  });

  it("package env var beats DEFAULT", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "listed-id";
    process.env.CREATOMATE_TEMPLATE_ID_DEFAULT = "default-id";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("listed-id");
  });

  it("trims whitespace from env vars", () => {
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED = "  trimmed-id  ";
    expect(resolveTemplateId({ selectedPackage: "just_listed" })).toBe("trimmed-id");
  });
});
