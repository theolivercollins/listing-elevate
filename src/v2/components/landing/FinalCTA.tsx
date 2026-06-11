import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";
import { Reveal } from "@/v2/components/primitives/Reveal";

/**
 * FinalCTA — clean elevated band with a radial ambient wash (WS3, 2026-06-11).
 *
 * The wash (mirrored from Hero, ellipse at 30% 100%) bookends the page.
 * Uses position:relative + pointer-events:none overlay so it never
 * interferes with interactive elements.
 */
export function FinalCTA() {
  const { openLogin } = useLoginDialog();
  return (
    <section
      style={{
        position: "relative",
        background: "var(--le-bg-elev)",
        borderTop: "1px solid var(--le-border)",
        padding: "clamp(48px, 7vw, 88px) clamp(16px, 5vw, 48px)",
        overflow: "hidden",
      }}
    >
      {/* Ambient radial wash — mirrors Hero, ellipse bottom-left */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 55% at 30% 100%, rgba(47, 109, 240, 0.07), transparent 60%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Reveal>
          <div
            className="le-eyebrow"
            style={{ marginBottom: 20, color: "var(--le-text-muted)" }}
          >
            — Get started
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <h2
            style={{
              fontSize: "clamp(40px, 5vw, 64px)",
              lineHeight: 1.02,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              fontFamily: "var(--le-font-sans)",
              color: "var(--le-text)",
              margin: "0 0 48px",
              maxWidth: 900,
            }}
          >
            Elevate your next listing.
          </h2>
        </Reveal>
        <Reveal delay={0.16}>
          <div
            className="le-flexcol-sm"
            style={{ display: "flex", alignItems: "center", gap: 28 }}
          >
            <LEButtonLink
              to="/upload"
              variant="primary"
              size="lg"
              className="le-cta-primary-hover"
            >
              Start a video <LEIcon name="arrow" size={14} color="currentColor" />
            </LEButtonLink>
            <button type="button" onClick={openLogin} className="le-cta-textlink">
              Sign in to your account
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
