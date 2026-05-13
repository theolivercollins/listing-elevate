import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CostProviderDonut } from "../CostProviderDonut";

describe("CostProviderDonut", () => {
  it("renders the total cents formatted as USD in the center", () => {
    const { getByText } = render(
      <CostProviderDonut
        rows={[
          { provider: "anthropic", cost_cents: 5000, pct: 50 },
          { provider: "kling-via-atlas", cost_cents: 5000, pct: 50 },
        ]}
        totalCents={10000}
        loading={false}
      />,
    );
    expect(getByText(/\$100\.00/)).toBeTruthy();
  });

  it("renders an empty state when no rows", () => {
    const { getByText } = render(
      <CostProviderDonut rows={[]} totalCents={0} loading={false} />,
    );
    expect(getByText(/no cost data/i)).toBeTruthy();
  });
});
