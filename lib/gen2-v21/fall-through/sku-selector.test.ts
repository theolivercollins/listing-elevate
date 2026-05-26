import { describe, it, expect } from "vitest";
import { pickV1SKU } from "./sku-selector.js";

describe("pickV1SKU", () => {
  it("returns kling-v2-6-pro by default (no args)", () => {
    expect(pickV1SKU()).toBe("kling-v2-6-pro");
  });

  it("returns kling-v2-6-pro when abMode is 'auto'", () => {
    expect(pickV1SKU({ abMode: "auto" })).toBe("kling-v2-6-pro");
  });

  it("returns kling-v2-6-pro when abMode is 'kling-v2-6-pro'", () => {
    expect(pickV1SKU({ abMode: "kling-v2-6-pro" })).toBe("kling-v2-6-pro");
  });

  it("returns seedance-pro-pushin when abMode is 'seedance-pro-pushin'", () => {
    expect(pickV1SKU({ abMode: "seedance-pro-pushin" })).toBe("seedance-pro-pushin");
  });
});
