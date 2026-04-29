import { useCallback, useEffect, useRef, useState } from "react";

export function useInViewOnce<T extends Element>(options: IntersectionObserverInit = { threshold: 0.2 }) {
  const [inView, setInView] = useState(false);
  const nodeRef = useRef<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const attach = useCallback((node: T | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    nodeRef.current = node;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
          observerRef.current = null;
          return;
        }
      }
    }, options);
    observer.observe(node);
    observerRef.current = observer;
  }, [options]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref: attach, inView };
}
