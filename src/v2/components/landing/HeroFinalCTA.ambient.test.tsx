/**
 * TDD tests for task t6-hero-finalcta-swap:
 *
 * Success criteria:
 * 1. Hero renders exactly one Ambient layer (.le-ambient) with the dots modifier.
 * 2. Hero no longer renders the old static aria-hidden wash div (the one whose
 *    inline style contained "radial-gradient" as a background AND was a direct
 *    sibling of SiteNav inside the <section>).
 * 3. FinalCTA renders exactly one Ambient layer (.le-ambient) with the dots modifier.
 * 4. FinalCTA no longer renders the old static aria-hidden wash div.
 * 5. data-testid="v2-landing-root" is present (Landing.tsx untouched).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Hero } from "@/v2/components/landing/Hero";
import { FinalCTA } from "@/v2/components/landing/FinalCTA";
import Landing from "@/v2/pages/Landing";

// ---- Hero ----
describe("Hero — Ambient swap", () => {
  function renderHero() {
    const { container } = render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );
    return container;
  }

  it("renders exactly one .le-ambient element inside <section>", () => {
    const c = renderHero();
    const ambients = c.querySelectorAll(".le-ambient");
    expect(ambients.length).toBe(1);
  });

  it(".le-ambient has the --dots modifier class", () => {
    const c = renderHero();
    const ambient = c.querySelector(".le-ambient");
    expect(ambient!.className).toContain("le-ambient--dots");
  });

  it("does NOT contain an old static wash div with an inline radial-gradient style", () => {
    const c = renderHero();
    // The old wash was an aria-hidden div with an inline background containing "radial-gradient"
    // and no .le-ambient class (which is the new Ambient's root).
    const allAriaHidden = c.querySelectorAll("[aria-hidden]");
    const oldStaticWash = Array.from(allAriaHidden).find((el) => {
      const bg = (el as HTMLElement).style.background;
      // The old wash's style.background started with "radial-gradient"
      return bg.startsWith("radial-gradient") && !el.classList.contains("le-ambient-blob");
    });
    expect(oldStaticWash).toBeUndefined();
  });
});

// ---- FinalCTA ----
describe("FinalCTA — Ambient swap", () => {
  function renderFinalCTA() {
    const { container } = render(
      <MemoryRouter>
        <FinalCTA />
      </MemoryRouter>
    );
    return container;
  }

  it("renders exactly one .le-ambient element inside <section>", () => {
    const c = renderFinalCTA();
    const ambients = c.querySelectorAll(".le-ambient");
    expect(ambients.length).toBe(1);
  });

  it(".le-ambient has the --dots modifier class", () => {
    const c = renderFinalCTA();
    const ambient = c.querySelector(".le-ambient");
    expect(ambient!.className).toContain("le-ambient--dots");
  });

  it("does NOT contain an old static wash div with an inline radial-gradient style", () => {
    const c = renderFinalCTA();
    const allAriaHidden = c.querySelectorAll("[aria-hidden]");
    const oldStaticWash = Array.from(allAriaHidden).find((el) => {
      const bg = (el as HTMLElement).style.background;
      return bg.startsWith("radial-gradient") && !el.classList.contains("le-ambient-blob");
    });
    expect(oldStaticWash).toBeUndefined();
  });
});

// ---- Landing integration ----
describe("Landing — data-testid untouched", () => {
  it("still renders data-testid='v2-landing-root'", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/v2"]}>
        <Landing />
      </MemoryRouter>
    );
    const root = container.querySelector("[data-testid='v2-landing-root']");
    expect(root).toBeTruthy();
  });
});
