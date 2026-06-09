import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { useAuth } from "@/lib/auth";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";
import { useTheme } from "@/lib/theme";

export interface SiteNavProps {
  /**
   * When true (default), show the anchor-link row (Process/Showcase/Pricing/FAQ).
   * Pages without those sections pass `false` to hide them.
   */
  showSectionLinks?: boolean;
  /**
   * When true, render with an opaque theme-aware surface (for app pages
   * like /account and /upload that sit on top of the page background and
   * shouldn't bleed through). Default false keeps the gradient scrim +
   * backdrop blur used on the landing hero.
   */
  solid?: boolean;
}

const navLinkStyle = {
  color: "inherit",
  textDecoration: "none",
} as const;

/**
 * SiteNav — shared top navigation primitive.
 *
 * Fixed to the viewport top (zIndex 20). In the default (gradient) mode
 * it uses a dark scrim + backdrop blur so it stays legible over any hero
 * image. Left: logo mark linking home. Center: optional section anchors.
 * Right: sign-in affordances (or account/dashboard/sign-out when
 * authenticated) plus a theme-toggle sun/moon button wired to the global
 * ThemeProvider.
 *
 * When `solid` is true, renders against an opaque `var(--le-bg)` surface
 * with a 1px bottom border and theme-reactive text colors — used on app
 * pages where the gradient scrim would otherwise bleed through.
 */
export function SiteNav({ showSectionLinks = true, solid = false }: SiteNavProps) {
  const { user, profile, signOut } = useAuth();
  const { openLogin } = useLoginDialog();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const isAdmin = profile?.role === "admin";

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  // Color palette — gradient mode uses hardcoded white-on-dark; solid mode
  // pulls from CSS vars so the nav follows the global theme.
  const textPrimary = solid ? "var(--le-text)" : "#fff";
  const textMuted = solid ? "var(--le-text-muted)" : "rgba(255,255,255,0.82)";
  const textSoft = solid ? "var(--le-text-muted)" : "rgba(255,255,255,0.92)";
  const textDim = solid ? "var(--le-text-faint)" : "rgba(255,255,255,0.65)";
  const textBody = solid ? "var(--le-text-muted)" : "rgba(255,255,255,0.85)";
  const iconBorder = solid ? "1px solid var(--le-border-strong)" : "1px solid rgba(255,255,255,0.22)";
  const iconColor = solid ? "var(--le-text)" : "#fff";

  const navStyle: CSSProperties = solid
    ? ({
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "26px 48px",
        color: "var(--le-text)",
        zIndex: 20,
        background: "var(--le-bg)",
        borderBottom: "1px solid var(--le-border)",
        // .le-nav-link hover target — full-strength text in this mode.
        "--le-nav-hover-color": "var(--le-text)",
      } as CSSProperties)
    : ({
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "26px 48px",
        color: "#fff",
        zIndex: 20,
        background:
          "linear-gradient(180deg, rgba(5,7,16,0.82) 0%, rgba(5,7,16,0.55) 65%, rgba(5,7,16,0) 100%)",
        backdropFilter: "blur(14px) saturate(1.2)",
        WebkitBackdropFilter: "blur(14px) saturate(1.2)",
        // .le-nav-link hover target — always on a dark scrim here.
        "--le-nav-hover-color": "#fff",
      } as CSSProperties);

  // In solid mode, pick a logo variant that reads on the current bg.
  // In gradient mode we're always on a dark scrim, so "light" (white) logo.
  const logoVariant = solid ? (theme === "dark" ? "light" : "dark") : "light";

  const toggleIconName = theme === "dark" ? "sun" : "moon";
  const toggleAriaLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <nav style={navStyle}>
      <Link
        to="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          textDecoration: "none",
        }}
      >
        <LELogoMark size={38} variant={logoVariant} />
      </Link>

      {showSectionLinks ? (
        <div
          style={{
            display: "flex",
            gap: 44,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: textMuted,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          <a href="#process" className="le-nav-link" style={navLinkStyle}>
            Process
          </a>
          <a href="#showcase" className="le-nav-link" style={navLinkStyle}>
            Showcase
          </a>
          <a href="#pricing" className="le-nav-link" style={navLinkStyle}>
            Pricing
          </a>
          <a href="#faq" className="le-nav-link" style={navLinkStyle}>
            FAQ
          </a>
        </div>
      ) : (
        <span aria-hidden />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="button"
          aria-label={toggleAriaLabel}
          onClick={toggle}
          style={{
            width: 34,
            height: 34,
            border: iconBorder,
            borderRadius: 6,
            background: "transparent",
            color: iconColor,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <LEIcon name={toggleIconName} size={14} color={iconColor} />
        </button>

        {user ? (
          <>
            <Link
              to="/account"
              className="le-nav-link"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: textSoft,
                textDecoration: "none",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Account
            </Link>
            {isAdmin && (
              <Link
                to="/dashboard"
                className="le-nav-link"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: textSoft,
                  textDecoration: "none",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Dashboard
              </Link>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="le-nav-link"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: textDim,
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={openLogin}
              className="le-nav-link"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: 13,
                color: textBody,
                textDecoration: "none",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Sign in
            </button>
            <LEButtonLink to="/upload" variant="primary" size="sm" className="le-cta-primary-hover">
              Get started <LEIcon name="arrow" size={12} color="var(--le-accent-fg)" />
            </LEButtonLink>
          </>
        )}
      </div>
    </nav>
  );
}

