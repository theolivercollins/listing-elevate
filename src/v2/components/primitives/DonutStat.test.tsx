import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DonutStat } from "./DonutStat";

describe("DonutStat", () => {
  it("renders the main percent and label when animate=false", () => {
    render(
      <DonutStat
        percent={73}
        label="prefer agents who use video"
        animate={false}
      />,
    );
    expect(screen.getByText(/73%/)).toBeTruthy();
    expect(screen.getByText(/prefer agents who use video/i)).toBeTruthy();
  });

  it("renders the counter-stat when provided", () => {
    render(
      <DonutStat
        percent={73}
        label="prefer agents who use video"
        counterPercent={11}
        counterLabel="of agents actually offer it"
        animate={false}
      />,
    );
    expect(screen.getByText(/11%/)).toBeTruthy();
    expect(screen.getByText(/of agents actually offer it/i)).toBeTruthy();
  });

  it("renders without crashing when animate=true", () => {
    const { container } = render(
      <DonutStat
        percent={73}
        label="prefer agents who use video"
        animate={true}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
