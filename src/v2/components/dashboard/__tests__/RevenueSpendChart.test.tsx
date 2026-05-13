import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RevenueSpendChart } from "../RevenueSpendChart";

describe("RevenueSpendChart", () => {
  it("renders without crashing on an empty series", () => {
    const { container } = render(<RevenueSpendChart points={[]} loading={false} />);
    expect(container.querySelector(".recharts-wrapper, svg, [data-testid='chart-empty']")).toBeTruthy();
  });

  it("renders a loading skeleton when loading", () => {
    const { getByText } = render(<RevenueSpendChart points={[]} loading={true} />);
    expect(getByText(/loading/i)).toBeTruthy();
  });

  it("shows revenue + spend totals in the header when given data", () => {
    const { getByText } = render(
      <RevenueSpendChart
        points={[
          { date: "2026-05-01", revenue_cents: 50000, spend_cents: 20000 },
          { date: "2026-05-02", revenue_cents: 70000, spend_cents: 30000 },
        ]}
        loading={false}
      />,
    );
    // total revenue = $1,200.00 ; total spend = $500.00
    expect(getByText(/\$1,200\.00/)).toBeTruthy();
    expect(getByText(/\$500\.00/)).toBeTruthy();
  });
});
