import { useEffect, useState } from "react";

export function useCountUp(
  end: number,
  duration: number = 2000,
  start: boolean = true,
  from: number = 0
) {
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (!start) {
      setValue(from);
      return;
    }

    let startTime: number | null = null;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (end - from) * eased));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration, start, from]);

  return value;
}
