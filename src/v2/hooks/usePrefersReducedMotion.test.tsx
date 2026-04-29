import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

describe("usePrefersReducedMotion", () => {
  it("returns true when media query matches", () => {
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
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when media query does not match", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
