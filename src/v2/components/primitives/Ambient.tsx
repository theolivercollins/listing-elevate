/**
 * Ambient — presentational ambient-aura layer.
 *
 * Renders an aria-hidden absolutely-positioned inset container that
 * holds two animated brand-blue gradient blobs and an optional tiled
 * dot layer. All motion comes from CSS keyframes defined in v2.css
 * (le-drift, le-drift-2, le-dot-drift) gated inside
 * @media (prefers-reduced-motion: no-preference) — no JS animation here.
 *
 * Usage:
 *   <div style={{ position: 'relative' }}>
 *     <Ambient dots intensity="softer" />
 *     {/* section content *\/}
 *   </div>
 *
 * Props:
 *   dots      — when true, renders a tiled dot layer (.le-ambient-dots)
 *               and adds the mask modifier (.le-ambient--dots) on root.
 *   intensity — 'softer' halves blob alpha via .le-ambient--softer CSS class;
 *               'normal' (default) is full strength.
 *
 * The blob inline styles use rgba(var(--le-brand-blue-rgb), …) for fills
 * so they track the token in tokens.css. Sizes and offsets are given as
 * inline width/height/top/left/right/bottom (positional geometry — not
 * a radius token violation). border-radius:50% comes from .le-ambient-blob.
 */

interface AmbientProps {
  dots?: boolean;
  intensity?: "normal" | "softer";
}

export function Ambient({ dots, intensity }: AmbientProps) {
  const rootClass = [
    "le-ambient",
    intensity === "softer" ? "le-ambient--softer" : "",
    dots ? "le-ambient--dots" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} aria-hidden="true">
      {/* Blob A — anchored top-left */}
      <div
        className="le-ambient-blob"
        style={{
          top: "-10%",
          left: "-5%",
          width: "50%",
          height: "50%",
          background: "radial-gradient(circle, rgba(var(--le-brand-blue-rgb), 0.07) 0%, transparent 70%)",
        }}
      />
      {/* Blob B — anchored bottom-right */}
      <div
        className="le-ambient-blob le-ambient-blob--b"
        style={{
          bottom: "-10%",
          right: "-5%",
          width: "45%",
          height: "45%",
          background: "radial-gradient(circle, rgba(var(--le-brand-blue-rgb), 0.05) 0%, transparent 70%)",
        }}
      />
      {/* Optional tiled dot layer */}
      {dots && <div className="le-ambient-dots" />}
    </div>
  );
}
