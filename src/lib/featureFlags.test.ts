import { describe, it, expect, beforeEach, vi } from "vitest";

describe("isDashboardV3Enabled", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true when VITE_LE_DASHBOARD_V3 is 'true'", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "true");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(true);
  });

  it("returns false when VITE_LE_DASHBOARD_V3 is undefined", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(false);
  });

  it("returns false for any value other than the literal string 'true'", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "1");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(false);
  });
});
