import { useEffect, useRef, useState } from "react";

/**
 * Returns a 0-1 progress value based on how far the element
 * has scrolled through the viewport.
 *
 * Mobile fix: uses a tighter scroll window — progress goes from 0 to 1
 * as the element scrolls from "center of viewport" to "top of viewport",
 * rather than the full entry-to-exit range. This ensures all steps
 * animate in before the user scrolls past, regardless of element height.
 */
export function useScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const viewH = window.innerHeight;

      // Use a tighter window: start when element enters bottom 80% of viewport,
      // complete when element's center reaches 20% from the top.
      // This is much more forgiving on mobile where elements are tall.
      const startTrigger = viewH * 0.9;   // element top enters here → progress = 0
      const endTrigger = viewH * 0.15;    // element top reaches here → progress = 1

      const p = Math.max(0, Math.min(1,
        (startTrigger - rect.top) / (startTrigger - endTrigger)
      ));

      setProgress(p);
    };

    // Use both scroll and resize to handle orientation changes on mobile
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll(); // initial check

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { ref, progress };
}
