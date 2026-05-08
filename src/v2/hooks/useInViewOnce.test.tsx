import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInViewOnce } from "./useInViewOnce";

describe("useInViewOnce", () => {
  let observerCallback: IntersectionObserverCallback = () => {};

  beforeEach(() => {
    class MockIO implements Partial<IntersectionObserver> {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
    }
    (globalThis as any).IntersectionObserver = MockIO as unknown as typeof IntersectionObserver;
  });

  it("starts false, flips to true after intersection, and stays true", () => {
    const { result } = renderHook(() => useInViewOnce<HTMLDivElement>());
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });
    expect(result.current.inView).toBe(false);

    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(result.current.inView).toBe(true);

    // Subsequent leave should not flip back
    act(() => {
      observerCallback(
        [{ isIntersecting: false, target: el } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(result.current.inView).toBe(true);
  });
});
