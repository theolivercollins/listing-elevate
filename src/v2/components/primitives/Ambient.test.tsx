/**
 * TDD tests for Ambient.tsx — src/v2/components/primitives/Ambient.tsx
 *
 * Success criteria (per task t3-ambient-primitive):
 * 1. Renders an aria-hidden root with className containing 'le-ambient'.
 * 2. Renders the dots layer (.le-ambient-dots) only when dots prop is set.
 * 3. Applies 'le-ambient--softer' modifier class when intensity='softer'.
 * 4. Always renders exactly two blob divs (.le-ambient-blob).
 * 5. Root is aria-hidden="true" (presentational layer).
 * 6. Does NOT render dots div when dots prop is absent / false.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Ambient } from "./Ambient";

describe("Ambient", () => {
  it("renders an aria-hidden root with className containing 'le-ambient'", () => {
    const { container } = render(<Ambient />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.className).toContain("le-ambient");
  });

  it("renders exactly two blob divs", () => {
    const { container } = render(<Ambient />);
    const blobs = container.querySelectorAll(".le-ambient-blob");
    expect(blobs.length).toBe(2);
  });

  it("does NOT render the dots div when dots prop is absent", () => {
    const { container } = render(<Ambient />);
    const dots = container.querySelectorAll(".le-ambient-dots");
    expect(dots.length).toBe(0);
  });

  it("does NOT render the dots div when dots={false}", () => {
    const { container } = render(<Ambient dots={false} />);
    const dots = container.querySelectorAll(".le-ambient-dots");
    expect(dots.length).toBe(0);
  });

  it("renders the dots div when dots={true}", () => {
    const { container } = render(<Ambient dots={true} />);
    const dots = container.querySelectorAll(".le-ambient-dots");
    expect(dots.length).toBe(1);
  });

  it("adds 'le-ambient--dots' modifier on root when dots={true}", () => {
    const { container } = render(<Ambient dots={true} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("le-ambient--dots");
  });

  it("does NOT add 'le-ambient--softer' when intensity is not set", () => {
    const { container } = render(<Ambient />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("le-ambient--softer");
  });

  it("adds 'le-ambient--softer' when intensity='softer'", () => {
    const { container } = render(<Ambient intensity="softer" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("le-ambient--softer");
  });

  it("does NOT add 'le-ambient--softer' when intensity='normal'", () => {
    const { container } = render(<Ambient intensity="normal" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("le-ambient--softer");
  });

  it("second blob div has 'le-ambient-blob--b' modifier class", () => {
    const { container } = render(<Ambient />);
    const blobB = container.querySelector(".le-ambient-blob--b");
    expect(blobB).toBeTruthy();
  });
});
