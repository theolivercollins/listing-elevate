import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SavingsReveal } from "./SavingsReveal";

describe("SavingsReveal", () => {
  it("renders both market and elevate labels when animate=false", () => {
    render(
      <SavingsReveal
        marketLabel="$300–$1,500"
        marketMax={1500}
        elevateLabel="$65 starting"
        elevateValue={65}
        animate={false}
      />,
    );
    expect(screen.getByText("$300–$1,500")).toBeTruthy();
    expect(screen.getByText("$65 starting")).toBeTruthy();
  });

  it("computes and renders a savings callout", () => {
    render(
      <SavingsReveal
        marketLabel="$300–$1,500"
        marketMax={1500}
        elevateLabel="$65 starting"
        elevateValue={65}
        animate={false}
      />,
    );
    // 1500 - 65 = 1435
    expect(screen.getByText(/1,?435/)).toBeTruthy();
  });

  it("renders without crashing when animate=true", () => {
    render(
      <SavingsReveal
        marketLabel="$300–$1,500"
        marketMax={1500}
        elevateLabel="$65 starting"
        elevateValue={65}
        animate={true}
      />,
    );
    expect(screen.getByText("$65 starting")).toBeTruthy();
  });
});
