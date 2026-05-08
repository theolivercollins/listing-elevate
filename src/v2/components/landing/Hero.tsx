import { Link } from "react-router-dom";
import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LECyclingWord } from "@/v2/components/primitives/LECyclingWord";
import { SiteNav } from "@/v2/components/SiteNav";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";

// Full-bleed luxury-interior reference — matches landing.jsx line 7.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=2400&q=85";

/**
 * Hero — pixel-faithful port of landing.jsx lines 29-240.
 *
 * Nav lives in the shared `SiteNav` primitive (fixed at viewport top).
 */
export function Hero() {
  const { openLogin } = useLoginDialog();

  return (
    <section
      style={{
        position: "relative",
        height: 574,
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* Background image */}
      <img
        src={HERO_IMAGE}
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "brightness(0.62) saturate(1.05)",
        }}
      />

      {/* Legibility gradient — darkens top for nav, mid-airy, bottom for copy */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(5,7,14,0.85) 0%, rgba(5,7,14,0.15) 22%, rgba(5,7,14,0) 45%, rgba(5,7,14,0.35) 75%, rgba(5,7,14,0.7) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* NAV — shared, fixed at viewport top. */}
      <SiteNav />

      {/* HERO COPY — vertically centered within the section */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingLeft: 48,
          paddingRight: 48,
          paddingTop: 96,
          paddingBottom: 48,
          color: "#fff",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.75)",
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 18,
              height: 1,
              background: "rgba(255,255,255,0.5)",
              display: "inline-block",
            }}
          />
          Listing Elevate · Cinematic · On demand
        </div>
        <h1
          style={{
            fontSize: "clamp(56px, 9vw, 104px)",
            lineHeight: 0.96,
            margin: 0,
            fontWeight: 500,
            letterSpacing: "-0.035em",
            maxWidth: 1100,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          <LECyclingWord words={["Win", "Sell", "Retain"]} /> more listings.
        </h1>
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.5,
            maxWidth: 520,
            marginTop: 28,
            color: "rgba(255,255,255,0.78)",
            fontWeight: 400,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          Upload photos. Receive a directed, edited, cinematic listing video
          within 24&nbsp;hours. No crew, no scheduling, no post-production.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginTop: 40,
          }}
        >
          <Link
            to="/upload"
            style={{
              background: "#fff",
              color: "#07080c",
              border: "none",
              padding: "16px 22px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              letterSpacing: "-0.005em",
              borderRadius: 4,
              textDecoration: "none",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Start a video <LEIcon name="arrow" size={14} color="#07080c" />
          </Link>
          <button
            type="button"
            onClick={openLogin}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 14,
              color: "#fff",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Sign in to your account
            <LEIcon name="arrowUpRight" size={12} color="#fff" />
          </button>
        </div>
      </div>

    </section>
  );
}
