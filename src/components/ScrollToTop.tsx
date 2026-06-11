/**
 * ScrollToTop
 *
 * Resets window scroll to (0, 0) on every route change.
 * Placed inside <BrowserRouter> so it has access to the router context.
 *
 * Without this, the browser's default SPA scroll-restoration restores the
 * previous page's scroll position on navigation (e.g. navigating from the
 * long landing page to /upload was landing users at the bottom).
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
