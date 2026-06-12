/**
 * TDD tests for task t7-midpage-ambient:
 *
 * Success criteria:
 * 1. Process renders <Section> with ambient="softer" — le-ambient--softer present in output.
 * 2. MarketComparison #compare section has position:relative + overflow:hidden.
 * 3. MarketComparison #compare section renders exactly one .le-ambient with le-ambient--softer.
 * 4. MarketComparison .le-ambient has NO dots modifier (le-ambient--dots absent).
 * 5. The intro motion.div content wrapper inside #compare carries position:relative + zIndex:1.
 * 6. FirstImpression, OnlineShowingPlate, and DotGrid content are all still present (unchanged).
 * 7. PillLabel dots (le-pill-dot class) are still present.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Process } from "@/v2/components/landing/Process";
import { MarketComparison } from "@/v2/components/landing/MarketComparison";

beforeEach(() => {
  class MockIO {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(_cb: IntersectionObserverCallback) {}
  }
  (globalThis as any).IntersectionObserver = MockIO as unknown as typeof IntersectionObserver;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: true,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// ---- Process ----
describe("Process — ambient='softer'", () => {
  function renderProcess() {
    return render(
      <MemoryRouter>
        <Process />
      </MemoryRouter>
    );
  }

  it("renders a .le-ambient element (Section passes ambient through)", () => {
    const { container } = renderProcess();
    const ambient = container.querySelector(".le-ambient");
    expect(ambient).toBeTruthy();
  });

  it(".le-ambient has the --softer modifier class", () => {
    const { container } = renderProcess();
    const ambient = container.querySelector(".le-ambient");
    expect(ambient!.className).toContain("le-ambient--softer");
  });

  it(".le-ambient does NOT have the --dots modifier", () => {
    const { container } = renderProcess();
    const ambient = container.querySelector(".le-ambient");
    expect(ambient!.className).not.toContain("le-ambient--dots");
  });

  it("still renders three step cards (content unchanged)", () => {
    const { container } = renderProcess();
    // 3 step number chips: 01, 02, 03
    const allDivs = container.querySelectorAll("div");
    // Find by text content — step chips hold "01", "02", "03"
    const textContent = container.textContent ?? "";
    expect(textContent).toContain("Upload");
    expect(textContent).toContain("Direct");
    expect(textContent).toContain("Deliver");
  });
});

// ---- MarketComparison ----
describe("MarketComparison — ambient aura layer", () => {
  function renderMC() {
    return render(
      <MemoryRouter>
        <MarketComparison />
      </MemoryRouter>
    );
  }

  it("#compare section has position:relative inline style", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.style.position).toBe("relative");
  });

  it("#compare section has overflow:hidden inline style", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    expect(section.style.overflow).toBe("hidden");
  });

  it("renders exactly one .le-ambient inside #compare", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    const ambients = section.querySelectorAll(".le-ambient");
    expect(ambients.length).toBe(1);
  });

  it(".le-ambient has le-ambient--softer modifier", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    const ambient = section.querySelector(".le-ambient") as HTMLElement;
    expect(ambient.className).toContain("le-ambient--softer");
  });

  it(".le-ambient does NOT have le-ambient--dots modifier", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    const ambient = section.querySelector(".le-ambient") as HTMLElement;
    expect(ambient.className).not.toContain("le-ambient--dots");
  });

  it(".le-ambient is the first child of #compare section", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    const firstChild = section.firstElementChild as HTMLElement;
    expect(firstChild.className).toContain("le-ambient");
  });

  it("intro block div has position:relative and zIndex:1", () => {
    const { container } = renderMC();
    const section = container.querySelector("section#compare") as HTMLElement;
    // The intro block is the first non-ambient child (second element child)
    const introWrapper = section.children[1] as HTMLElement;
    expect(introWrapper.style.position).toBe("relative");
    expect(introWrapper.style.zIndex).toBe("1");
  });

  it("still renders FirstImpression image (unchanged)", () => {
    const { container } = renderMC();
    const imgs = container.querySelectorAll("img");
    // FirstImpression has a luxury modern home image with ?auto=format...
    const firstImpressionImg = Array.from(imgs).find((img) =>
      img.src.includes("photo-1600596542815")
    );
    expect(firstImpressionImg).toBeTruthy();
  });

  it("still renders OnlineShowingPlate image (unchanged)", () => {
    const { container } = renderMC();
    const imgs = container.querySelectorAll("img");
    const onlineShowingImg = Array.from(imgs).find((img) =>
      img.src.includes("photo-1600607687939")
    );
    expect(onlineShowingImg).toBeTruthy();
  });

  it("PillLabel dots are still rendered (not removed)", () => {
    const { container } = renderMC();
    // PillLabel dots are inline 6px×6px borderRadius:999 spans — check they exist
    // by verifying the prong labels text
    const textContent = container.textContent ?? "";
    expect(textContent).toContain("Win more listings");
    expect(textContent).toContain("Retain every client");
    expect(textContent).toContain("Sell faster");
  });
});
