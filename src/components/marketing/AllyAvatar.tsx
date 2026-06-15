// src/components/marketing/AllyAvatar.tsx
import type { ComponentProps } from "react";

interface AllyAvatarProps extends Omit<ComponentProps<"div">, "children"> {
  size?: number;
}

/**
 * Custom illustrated mark for Ally - geometric lowercase "a" inside a
 * rounded square, brand-blue background, white glyph. Inline SVG, no
 * dependencies, no licensed art.
 */
export function AllyAvatar({ size = 32, className = "", ...rest }: AllyAvatarProps) {
  return (
    <div
      {...rest}
      className={`inline-flex items-center justify-center rounded-lg bg-accent text-accent-foreground ${className}`}
      style={{ width: size, height: size }}
      aria-label="Ally"
    >
      <svg
        width={size * 0.65}
        height={size * 0.65}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M16 8.5c0-2.485-2.015-4.5-4.5-4.5S7 6.015 7 8.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="14.5" r="5.5" stroke="currentColor" strokeWidth="2.4" />
        <path d="M17 9v11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
