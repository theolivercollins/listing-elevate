import type { SVGProps } from "react";

interface LEGlyphMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
  variant?: "dark" | "light";
  className?: string;
}

const GLYPH_ASPECT = 443 / 397;

/**
 * Real Listing Elevate glyph — the three ascending rounded bars from the
 * chart mark, as an inline scalable SVG. Use this (not a cropped LELogoMark)
 * anywhere only the glyph is needed — sidebar rail, mobile bar, favicon-style
 * chips, etc. Geometry measured from `src/v2/assets/logo.png`.
 *
 * `size` controls the render HEIGHT; width scales from the fixed 443:397
 * aspect ratio so the glyph never distorts or clips.
 */
export function LEGlyphMark({
  size = 24,
  variant,
  className,
  ...rest
}: LEGlyphMarkProps) {
  const fill = variant === "light" ? "#FFFFFF" : variant === "dark" ? "#0E1424" : "currentColor";

  return (
    <svg
      role="img"
      aria-label="Listing Elevate"
      height={size}
      width={size * GLYPH_ASPECT}
      viewBox="0 0 443 397"
      preserveAspectRatio="xMidYMid meet"
      fill={fill}
      className={className}
      {...rest}
    >
      <rect x="0" y="246" width="125" height="151" rx="30" ry="30" />
      <rect x="159" y="124" width="125" height="273" rx="30" ry="30" />
      <rect x="318" y="0" width="125" height="397" rx="30" ry="30" />
    </svg>
  );
}
