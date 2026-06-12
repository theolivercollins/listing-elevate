/**
 * ScrollToTop — resets window scroll to (0,0) on every route change and
 * disables the browser's native scroll restoration so it cannot asynchronously
 * fight our explicit scrollTo(0, 0) calls.
 *
 * Background: the default window.history.scrollRestoration === 'auto' means
 * the browser may restore a previous scroll position (e.g. bottom of the long
 * landing page) AFTER our scrollTo fires, landing users mid-page on /upload.
 * Setting it to 'manual' gives us full ownership of scroll position.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { ScrollToTop } from "./ScrollToTop";

describe("ScrollToTop", () => {
  let scrollToSpy: MockInstance;
  let originalScrollRestoration: ScrollRestoration;

  beforeEach(() => {
    scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    // Capture and reset scrollRestoration before each test so tests are isolated.
    originalScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "auto";
  });

  afterEach(() => {
    window.history.scrollRestoration = originalScrollRestoration;
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

  it("sets window.history.scrollRestoration to 'manual' on mount", () => {
    expect(window.history.scrollRestoration).toBe("auto");

    render(
      <MemoryRouter initialEntries={["/upload"]}>
        <ScrollToTop />
        <Routes>
          <Route path="/upload" element={<span>upload</span>} />
        </Routes>
      </MemoryRouter>
    );

    expect(window.history.scrollRestoration).toBe("manual");
  });
});
