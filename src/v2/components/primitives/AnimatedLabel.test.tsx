import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnimatedLabel } from "./AnimatedLabel";

describe("AnimatedLabel", () => {
  it("renders the final label when animate=false (reduced motion)", () => {
    render(<AnimatedLabel label="$380" animate={false} />);
    expect(screen.getByText("$380")).toBeTruthy();
  });

  it("renders the final label when animate=true and start has completed", () => {
    render(<AnimatedLabel label="$380" animate={true} />);
    expect(screen.getByText("$380")).toBeTruthy();
  });
});
