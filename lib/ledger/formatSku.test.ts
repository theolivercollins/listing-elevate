import { describe, it, expect } from "vitest";
import { formatRowSku } from "./formatSku.js";

describe("formatRowSku", () => {
  it("returns the captured SKU for an atlas row with model_used populated", () => {
    const r = formatRowSku({ modelUsed: "kling-v2-6-pro", provider: "atlas" });
    expect(r.sku).toBe("kling-v2-6-pro");
    expect(r.has_model_used).toBe(true);
  });

  it("NEVER returns the bare 'atlas' provider string as a SKU", () => {
    // Legacy/missing-SKU atlas rows must surface null (UI renders a no-SKU
    // chip) rather than leaking the aggregator name as if it were a model.
    const r = formatRowSku({ modelUsed: null, provider: "atlas" });
    expect(r.sku).not.toBe("atlas");
    expect(r.sku).toBeNull();
    expect(r.has_model_used).toBe(false);
  });

  it("maps legacy kling rows to kling-v2-native when model_used is null", () => {
    const r = formatRowSku({ modelUsed: null, provider: "kling" });
    expect(r.sku).toBe("kling-v2-native");
    expect(r.has_model_used).toBe(false);
  });

  it("maps legacy runway rows to the native Gen-4 Turbo SKU", () => {
    const r = formatRowSku({ modelUsed: null, provider: "runway" });
    expect(r.sku).toBe("runway-gen-4-turbo");
    expect(r.has_model_used).toBe(false);
  });

  it("prefers captured model_used over provider-native fallback", () => {
    const r = formatRowSku({ modelUsed: "kling-v2-native", provider: "kling" });
    expect(r.sku).toBe("kling-v2-native");
    expect(r.has_model_used).toBe(true);
  });

  it("returns null when both provider and model_used are missing", () => {
    const r = formatRowSku({ modelUsed: null, provider: null });
    expect(r.sku).toBeNull();
    expect(r.has_model_used).toBe(false);
  });

  it("handles empty-string model_used as missing", () => {
    const r = formatRowSku({ modelUsed: "", provider: "atlas" });
    expect(r.sku).toBeNull();
    expect(r.has_model_used).toBe(false);
  });
});
