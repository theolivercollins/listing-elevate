/**
 * ScrollToTop — resets window scroll to (0,0) on every route change.
 *
 * This prevents the browser's default SPA scroll-restoration behaviour from
 * landing users mid-page when navigating between routes (e.g. the landing page
 * is long; navigating to /upload was landing at the bottom of the previous
 * scroll position).
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { ScrollToTop } from "./ScrollToTop";

describe("ScrollToTop", () => {
  let scrollToSpy: MockInstance;

  beforeEach(() => {
    scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  it("calls window.scrollTo(0, 0) when the route changes", () => {
    // Render inside a MemoryRouter starting at /page-a
    const { getByRole } = render(
      <MemoryRouter initialEntries={["/page-a"]}>
        <ScrollToTop />
        <Routes>
          <Route path="/page-a" element={<Link to="/page-b">go to b</Link>} />
          <Route path="/page-b" element={<span>page b</span>} />
        </Routes>
      </MemoryRouter>
    );

    const callsBefore = scrollToSpy.mock.calls.length;

    // Navigate to /page-b
    act(() => {
      getByRole("link", { name: /go to b/i }).click();
    });

    const callsAfter = scrollToSpy.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    expect(scrollToSpy.mock.calls[callsAfter - 1]).toEqual([0, 0]);
  });

  it("calls window.scrollTo(0, 0) on initial mount", () => {
    render(
      <MemoryRouter initialEntries={["/upload"]}>
        <ScrollToTop />
        <Routes>
          <Route path="/upload" element={<span>upload</span>} />
        </Routes>
      </MemoryRouter>
    );

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });
});
