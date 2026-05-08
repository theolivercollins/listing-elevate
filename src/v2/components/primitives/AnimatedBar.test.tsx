import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnimatedBar } from "./AnimatedBar";

describe("AnimatedBar", () => {
  it("renders a bar with the given aria value", () => {
    const { container } = render(
      <AnimatedBar fillPercent={42} animate={false} variant="market" label="Market" />
    );
    const bar = container.querySelector('[role="meter"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("reduced-motion variant snaps to the final width without a transition", () => {
    const { container } = render(
      <AnimatedBar fillPercent={80} animate={false} variant="elevate" label="Elevate" />
    );
    const fill = container.querySelector('[data-testid="bar-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("80%");
  });
});
