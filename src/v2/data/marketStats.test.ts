import { describe, it, expect } from "vitest";
import { getMarketStats } from "./marketStats";

describe("getMarketStats", () => {
  it("returns between 3 and 5 rows (spec cuts any row that cannot be cited)", async () => {
    const rows = await getMarketStats();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it("every row has market + elevate values and a citation URL", async () => {
    const rows = await getMarketStats();
    for (const row of rows) {
      expect(row.id).toMatch(/.+/);
      expect(row.dimension).toMatch(/.+/);
      expect(row.market.label).toMatch(/.+/);
      expect(row.elevate.label).toMatch(/.+/);
      expect(row.source.label).toMatch(/.+/);
      expect(row.source.url).toMatch(/^https?:\/\//);
    }
  });
});
