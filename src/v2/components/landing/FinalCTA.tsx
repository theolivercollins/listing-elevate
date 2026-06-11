import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";

/**
 * FinalCTA — light SaaS CTA band (2026-06-11).
 *
 * Removed the photo background and dark scrims. Now a clean elevated
 * band on var(--le-bg-elev) with a top border — no photography, no dark.
 */
export function FinalCTA() {
  const { openLogin } = useLoginDialog();
  return (
    <section
      style={{
        background: "var(--le-bg-elev)",
        borderTop: "1px solid var(--le-border)",
        padding: "clamp(64px, 14vw, 160px) clamp(16px, 5vw, 48px)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <div className="le-eyebrow" style={{ marginBottom: 24, color: "var(--le-text-muted)" }}>
          — Get started
        </div>
        <h2
          style={{
            fontSize: "clamp(52px, 7vw, 96px)",
            lineHeight: 0.96,
            fontWeight: 500,
            letterSpacing: "-0.035em",
            fontFamily: "var(--le-font-sans)",
            color: "var(--le-text)",
            margin: "0 0 48px",
            maxWidth: 900,
          }}
        >
          Elevate your next listing.
        </h2>
        <div className="le-flexcol-sm" style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LEButtonLink
            to="/upload"
            variant="primary"
            size="lg"
            className="le-cta-primary-hover"
            style={{ padding: "16px 24px", gap: 10 }}
          >
            Start a video <LEIcon name="arrow" size={14} color="currentColor" />
          </LEButtonLink>
          <button type="button" onClick={openLogin} className="le-cta-textlink">
            Sign in to your account
          </button>
        </div>
      </div>
    </section>
  );
}
