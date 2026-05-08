import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DotGrid } from "./DotGrid";

describe("DotGrid", () => {
  it("renders the label when animate=false", () => {
    render(
      <DotGrid
        filled={84}
        total={100}
        label="84 out of 100 consumers want more video from brands"
        animate={false}
      />,
    );
    expect(
      screen.getByText(/84 out of 100 consumers want more video from brands/i),
    ).toBeTruthy();
  });

  it("renders exactly total dots", () => {
    const { container } = render(
      <DotGrid
        filled={84}
        total={100}
        label="84 out of 100 consumers want more video from brands"
        animate={false}
      />,
    );
    const dots = container.querySelectorAll("[data-dot]");
    expect(dots.length).toBe(100);
  });

  it("marks the first `filled` dots as filled", () => {
    const { container } = render(
      <DotGrid
        filled={84}
        total={100}
        label="demand"
        animate={false}
      />,
    );
    const filled = container.querySelectorAll('[data-dot="filled"]');
    const empty = container.querySelectorAll('[data-dot="empty"]');
    expect(filled.length).toBe(84);
    expect(empty.length).toBe(16);
  });

  it("renders without crashing when animate=true", () => {
    const { container } = render(
      <DotGrid
        filled={84}
        total={100}
        label="demand"
        animate={true}
      />,
    );
    expect(container.querySelectorAll("[data-dot]").length).toBe(100);
  });
});
