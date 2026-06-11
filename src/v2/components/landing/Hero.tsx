import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { LECyclingWord } from "@/v2/components/primitives/LECyclingWord";
import { SiteNav } from "@/v2/components/SiteNav";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";

// Full-bleed luxury-interior reference — matches landing.jsx line 7.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=2400&q=85";

/**
 * Hero — light SaaS redesign (2026-06-11).
 *
 * Structure: white section, left-aligned copy, then a wide framed
 * media card containing the interior photo. No dark scrims, no
 * full-bleed background image — the photo is a contained element
 * below the headline copy.
 *
 * Nav lives in the shared `SiteNav` primitive (fixed at viewport top).
 */
export function Hero() {
  const { openLogin } = useLoginDialog();

  return (
    <section
      style={{
        background: "var(--le-bg)",
        paddingTop: 140,
        paddingBottom: 96,
        paddingLeft: "clamp(16px, 5vw, 48px)",
        paddingRight: "clamp(16px, 5vw, 48px)",
      }}
    >
      {/* NAV — shared, fixed at viewport top. */}
      <SiteNav />

      {/* HERO COPY — left-aligned */}
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Eyebrow */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "var(--le-text-muted)",
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          <span
            style={{
              width: 18,
              height: 1,
              background: "var(--le-border-strong)",
              display: "inline-block",
            }}
          />
          Listing Elevate · Cinematic · On demand
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: "clamp(48px, 7vw, 88px)",
            lineHeight: 0.96,
            margin: 0,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            maxWidth: 1100,
            fontFamily: "var(--le-font-sans)",
            color: "var(--le-text)",
          }}
        >
          <LECyclingWord words={["Win", "Sell", "Retain"]} /> more listings.
        </h1>

        {/* Subcopy */}
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.5,
            maxWidth: 520,
            marginTop: 28,
            color: "var(--le-text-muted)",
            fontWeight: 400,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          Upload photos. Receive a directed, edited, cinematic listing video
          within 24&nbsp;hours. No crew, no scheduling, no post-production.
        </p>

        {/* CTAs */}
        <div
          className="le-flexcol-sm"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginTop: 40,
          }}
        >
          <LEButtonLink
            to="/upload"
            variant="primary"
            size="lg"
            className="le-cta-primary-hover"
            style={{ padding: "16px 22px", gap: 10 }}
          >
            Start a video <LEIcon name="arrow" size={14} color="currentColor" />
          </LEButtonLink>
          <button type="button" onClick={openLogin} className="le-cta-textlink">
            Sign in to your account
            <LEIcon name="arrowUpRight" size={12} color="currentColor" />
          </button>
        </div>

        {/* Framed media card — photo below the copy */}
        <div
          style={{
            marginTop: 64,
            borderRadius: 18,
            overflow: "hidden",
            aspectRatio: "21 / 9",
            boxShadow: "var(--le-shadow-lg)",
            border: "1px solid var(--le-border)",
            position: "relative",
          }}
        >
          <img
            src={HERO_IMAGE}
            alt="Luxury interior listing"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </div>
    </section>
  );
}
