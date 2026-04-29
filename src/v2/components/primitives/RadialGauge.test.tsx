import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RadialGauge } from "./RadialGauge";

describe("RadialGauge", () => {
  it("renders both labels when animate=false", () => {
    render(
      <RadialGauge
        marketHours={72}
        marketLabel="48–72 hours"
        elevateHours={24}
        elevateLabel="Under 24 hours"
        animate={false}
      />,
    );
    expect(screen.getByText("48–72 hours")).toBeTruthy();
    expect(screen.getByText("Under 24 hours")).toBeTruthy();
  });

  it("renders the MARKET and ELEVATE tick markers", () => {
    render(
      <RadialGauge
        marketHours={72}
        marketLabel="48–72 hours"
        elevateHours={24}
        elevateLabel="Under 24 hours"
        animate={false}
      />,
    );
    expect(screen.getByText(/MARKET/i)).toBeTruthy();
    expect(screen.getByText(/ELEVATE/i)).toBeTruthy();
  });

  it("renders without crashing when animate=true", () => {
    const { container } = render(
      <RadialGauge
        marketHours={72}
        marketLabel="48–72 hours"
        elevateHours={24}
        elevateLabel="Under 24 hours"
        animate={true}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
