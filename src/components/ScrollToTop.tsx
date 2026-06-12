/**
 * ScrollToTop
 *
 * Resets window scroll to (0, 0) on every route change.
 * Placed inside <BrowserRouter> so it has access to the router context.
 *
 * Without this, the browser's default SPA scroll-restoration restores the
 * previous page's scroll position on navigation (e.g. navigating from the
 * long landing page to /upload was landing users at the bottom).
 *
 * We also set window.history.scrollRestoration = 'manual' once on mount so
 * the browser's native restoration logic does not asynchronously fight our
 * explicit scrollTo(0, 0) calls (the default 'auto' can fire after our effect
 * and put the viewport back wherever it was on the previous page).
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function ScrollToTop() {
  const { pathname } = useLocation();

  // Disable browser-native scroll restoration once, at app boot.
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
