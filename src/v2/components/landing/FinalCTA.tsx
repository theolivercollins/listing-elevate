import { Link } from "react-router-dom";
import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";

const BG =
  "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=2400&q=85";

export function FinalCTA() {
  const { openLogin } = useLoginDialog();
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "160px 48px",
        background: "#000",
      }}
    >
      <img
        src={BG}
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "brightness(0.45) saturate(1.1)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(5,7,14,0.2) 0%, rgba(5,7,14,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 2,
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <div className="le-eyebrow" style={{ marginBottom: 24, color: "rgba(255,255,255,0.6)" }}>
          — Get started
        </div>
        <h2
          style={{
            fontSize: "clamp(52px, 7vw, 96px)",
            lineHeight: 0.96,
            fontWeight: 500,
            letterSpacing: "-0.035em",
            fontFamily: "var(--le-font-sans)",
            color: "#fff",
            margin: "0 0 48px",
            maxWidth: 900,
          }}
        >
          Elevate your next listing.
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Link
            to="/upload"
            style={{
              background: "#fff",
              color: "#07080c",
              border: "none",
              padding: "16px 24px",
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
              color: "rgba(255,255,255,0.78)",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Sign in to your account
          </button>
        </div>
      </div>
    </section>
  );
}
