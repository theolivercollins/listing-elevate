import { useEffect, useState } from "react";

interface LECyclingWordProps {
  words: string[];
  /** Milliseconds each word holds before the next swaps in. Default 3400. */
  interval?: number;
}

/**
 * Cascade-drop word cycler — matches the `HA_Cascade` variant from
 * hero_anims.jsx. Each letter of the incoming word re-animates with a
 * 45ms stagger using the shared `le-cascade` keyframes in tokens.css.
 */
export function LECyclingWord({ words, interval = 3400 }: LECyclingWordProps) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (words.length <= 1) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % words.length), interval);
    return () => clearTimeout(t);
  }, [idx, interval, words]);

  const word = words[idx] ?? "";

  return (
    <span
      style={{
        display: "inline-block",
        verticalAlign: "baseline",
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: "'tnum'",
      }}
    >
      {word.split("").map((ch, i) => (
        <span
          key={`${idx}-${i}`}
          style={{
            display: "inline-block",
            animation: "le-cascade 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
            animationDelay: `${i * 45}ms`,
          }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}
