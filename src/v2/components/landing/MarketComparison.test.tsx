import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketComparison } from "./MarketComparison";

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

describe("MarketComparison", () => {
  it("renders the intro headline without crashing", () => {
    render(<MarketComparison />);
    expect(
      screen.getByText(/Why agents who use Listing Elevate/i)
    ).toBeTruthy();
  });

  it("renders the section headers for each pitch prong", () => {
    render(<MarketComparison />);
    // "Win more listings" appears in both the SectionHeader and in the
    // MarketDomination flywheel step list — use getAllByText to allow multiple.
    expect(screen.getAllByText(/Win more listings/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Retain every client/i)).toBeTruthy();
    expect(screen.getByText(/Sell faster/i)).toBeTruthy();
    // "The math" section (PricingCalculator) was archived 2026-04-21;
    // no longer rendered in MarketComparison — assertion removed.
  });
});
