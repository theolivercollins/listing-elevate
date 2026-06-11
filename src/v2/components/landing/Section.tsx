import type { ReactNode, CSSProperties } from "react";
import { Reveal } from "@/v2/components/primitives/Reveal";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  title?: string;
  lede?: string;
  tint?: boolean;
  maxWidth?: number;
  children: ReactNode;
  /** Rendered to the right of the title on a flex row, baseline-aligned. */
  aside?: ReactNode;
  style?: CSSProperties;
}

/**
 * Section — shared section shell for the landing page.
 *
 * All marketing sections use this to share a single left-edge column,
 * consistent vertical rhythm, and the alternating tint cadence.
 *
 * The heading block (eyebrow → title → lede) is Reveal-wrapped so it
 * entrance-animates on scroll. Children render below, carrying their
 * own Reveal staggering if needed.
 */
export function Section({
  id,
  eyebrow,
  title,
  lede,
  tint = false,
  maxWidth = 1200,
  children,
  aside,
  style,
}: SectionProps) {
  return (
    <section
      id={id}
      style={{
        background: tint ? "var(--le-surface-page, #f4f6fb)" : "var(--le-bg)",
        padding: "clamp(48px, 7vw, 88px) clamp(16px, 5vw, 48px)",
        ...style,
      }}
    >
      <div style={{ maxWidth, margin: "0 auto" }}>
        {(eyebrow || title || lede) && (
          <Reveal>
            <div>
              {eyebrow && (
                <div className="le-eyebrow" style={{ marginBottom: 20 }}>
                  {eyebrow}
                </div>
              )}
              {title && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: aside ? "space-between" : undefined,
                    alignItems: aside ? "flex-end" : undefined,
                    marginBottom: lede ? 16 : 48,
                  }}
                >
                  <h2
                    style={{
                      fontSize: "clamp(40px, 5vw, 64px)",
                      fontWeight: 600,
                      letterSpacing: "-0.03em",
                      lineHeight: 1.02,
                      margin: 0,
                      fontFamily: "var(--le-font-sans)",
                      color: "var(--le-text)",
                    }}
                  >
                    {title}
                  </h2>
                  {aside && (
                    <div style={{ flexShrink: 0, alignSelf: "flex-end" }}>
                      {aside}
                    </div>
                  )}
                </div>
              )}
              {lede && (
                <p
                  style={{
                    fontSize: 16,
                    lineHeight: 1.6,
                    color: "var(--le-text-muted)",
                    maxWidth: 640,
                    margin: "0 0 48px",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  {lede}
                </p>
              )}
            </div>
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}
