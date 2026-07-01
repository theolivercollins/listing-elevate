import { Loader2 } from "lucide-react";

/**
 * RouteLoader — lightweight Suspense fallback for lazy-loaded routes.
 *
 * AppRoutes.tsx code-splits the dashboard/studio/blog/email page components
 * via React.lazy so only the visited route's JS ships on that page load.
 * This is what briefly shows while a route's chunk downloads.
 *
 * Kept intentionally minimal (no copy, no monospace) and styled with the
 * shared --le-muted token — same color already used next to Loader2 across
 * the studio surfaces — but WITHOUT depending on the `.studio-scope` /
 * `.studio-spinner` CSS (that animation is scoped to studio pages and may
 * not have loaded yet for a route rendering for the very first time), so it
 * renders correctly no matter which route triggers it first.
 */
export function RouteLoader() {
  return (
    <div
      className="flex min-h-[50vh] w-full items-center justify-center py-16"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--le-muted)" }} />
    </div>
  );
}
