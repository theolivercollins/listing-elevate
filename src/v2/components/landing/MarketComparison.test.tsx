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
    expect(screen.getByText(/Win more listings/i)).toBeTruthy();
    expect(screen.getByText(/Retain every client/i)).toBeTruthy();
    expect(screen.getByText(/Sell faster/i)).toBeTruthy();
    expect(screen.getByText(/The math/i)).toBeTruthy();
  });
});
