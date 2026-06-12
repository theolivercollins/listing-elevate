/**
 * TDD tests for Section.tsx — src/v2/components/landing/Section.tsx
 *
 * Success criteria (per task t5-section-prop):
 * 1. When `ambient` prop is unset: no position/overflow added to <section>,
 *    no Ambient rendered, no zIndex on the column div.
 * 2. When `ambient={true}`: <section> gains position:relative + overflow:hidden;
 *    Ambient is rendered (aria-hidden div.le-ambient present, no dots class);
 *    inner column div gains position:relative + zIndex:1.
 * 3. When `ambient="softer"`: same structural additions as true, but Ambient
 *    gets the le-ambient--softer modifier class.
 * 4. Caller `style` prop still overrides (spread wins after base).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Section } from "./Section";

function renderSection(props: Parameters<typeof Section>[0]) {
  return render(
    <MemoryRouter>
      <Section {...props} />
    </MemoryRouter>
  );
}

describe("Section — ambient prop", () => {
  it("(no ambient) <section> has no position or overflow inline style", () => {
    const { container } = renderSection({ children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.position).toBe("");
    expect(section.style.overflow).toBe("");
  });

  it("(no ambient) does NOT render le-ambient", () => {
    const { container } = renderSection({ children: <span>x</span> });
    expect(container.querySelectorAll(".le-ambient").length).toBe(0);
  });

  it("(no ambient) column div has no zIndex", () => {
    const { container } = renderSection({ children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    // The column is the direct div child of section (first div inside section)
    const col = section.querySelector(":scope > div") as HTMLElement;
    expect(col.style.zIndex).toBe("");
  });

  it("(ambient=true) <section> gains position:relative", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.position).toBe("relative");
  });

  it("(ambient=true) <section> gains overflow:hidden", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.overflow).toBe("hidden");
  });

  it("(ambient=true) renders le-ambient (Ambient component)", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    expect(container.querySelectorAll(".le-ambient").length).toBe(1);
  });

  it("(ambient=true) Ambient has NO dots class", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    const ambient = container.querySelector(".le-ambient") as HTMLElement;
    expect(ambient.className).not.toContain("le-ambient--dots");
  });

  it("(ambient=true) column div gains position:relative", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    const col = section.querySelector(":scope > div:not([aria-hidden])") as HTMLElement;
    expect(col.style.position).toBe("relative");
  });

  it("(ambient=true) column div gains zIndex:1", () => {
    const { container } = renderSection({ ambient: true, children: <span>x</span> });
    const section = container.querySelector("section") as HTMLElement;
    const col = section.querySelector(":scope > div:not([aria-hidden])") as HTMLElement;
    expect(col.style.zIndex).toBe("1");
  });

  it("(ambient='softer') Ambient has le-ambient--softer modifier", () => {
    const { container } = renderSection({ ambient: "softer", children: <span>x</span> });
    const ambient = container.querySelector(".le-ambient") as HTMLElement;
    expect(ambient.className).toContain("le-ambient--softer");
  });

  it("(ambient='softer') does NOT add le-ambient--dots", () => {
    const { container } = renderSection({ ambient: "softer", children: <span>x</span> });
    const ambient = container.querySelector(".le-ambient") as HTMLElement;
    expect(ambient.className).not.toContain("le-ambient--dots");
  });

  it("caller style prop overrides base section styles", () => {
    const { container } = renderSection({
      ambient: true,
      style: { background: "red" },
      children: <span>x</span>,
    });
    const section = container.querySelector("section") as HTMLElement;
    // Caller override should win
    expect(section.style.background).toBe("red");
    // But ambient-added styles still present
    expect(section.style.position).toBe("relative");
  });
});
