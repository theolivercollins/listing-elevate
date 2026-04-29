import logoDark from "@/v2/assets/logo.png";
import logoWhite from "@/v2/assets/logo-white.png";

interface LELogoMarkProps {
  size?: number;
  variant?: "dark" | "light";
}

/**
 * Real Listing Elevate logo — horizontal lockup (chart + wordmark), aspect ~3.5:1.
 * `size` controls the HEIGHT of the render; width scales from the aspect ratio.
 * `variant="light"` uses the white-inverted PNG — for use on dark backgrounds.
 */
export function LELogoMark({ size = 24, variant = "dark" }: LELogoMarkProps) {
  const src = variant === "light" ? logoWhite : logoDark;
  const aspect = 2048 / 584;
  return (
    <img
      src={src}
      alt="Listing Elevate"
      style={{
        height: size * 1.1,
        width: size * 1.1 * aspect,
        display: "inline-block",
        verticalAlign: "middle",
      }}
    />
  );
}
