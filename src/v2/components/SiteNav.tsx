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
   * When true, render with a fully opaque `var(--le-bg)` surface — used on
   * app pages (/account, /upload) where the nav must sit on the page
   * background without bleed-through. Default false renders the translucent
   * frosted bar (`var(--le-nav-bg)` + backdrop-blur), which is white/0.85 in
   * light mode and near-black/0.7 in dark mode.
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
 * Fixed to the viewport top (zIndex 20). In the default mode it renders
 * as a light translucent bar (white/0.85 + backdrop blur) with a 1px
 * bottom border — clean SaaS product nav. Left: logo mark linking home.
 * Center: optional section anchors. Right: sign-in affordances (or
 * account/dashboard/sign-out when authenticated) plus a theme-toggle
 * sun/moon button wired to the global ThemeProvider.
 *
 * When `solid` is true, renders against an opaque `var(--le-bg)` surface
 * with a 1px bottom border and theme-reactive text colors — used on app
 * pages where the nav needs a fully opaque backdrop.
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

  // Both default and solid modes are now light-first; pull from CSS vars.
  const textMuted = "var(--le-text-muted)";
  const textSoft = "var(--le-text-muted)";
  const textDim = "var(--le-text-faint)";
  const textBody = "var(--le-text-muted)";
  const iconBorder = "1px solid var(--le-border-strong)";
  const iconColor = "var(--le-text)";

  // Shared base — both modes are translucent white bars on a light surface.
  const navBase: CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 48px",
    color: "var(--le-text)",
    zIndex: 20,
    borderBottom: "1px solid var(--le-border)",
    backdropFilter: "blur(16px) saturate(1.4)",
    WebkitBackdropFilter: "blur(16px) saturate(1.4)",
    "--le-nav-hover-color": "var(--le-text)",
  } as CSSProperties;

  const navStyle: CSSProperties = solid
    ? { ...navBase, background: "var(--le-bg)" }
    : { ...navBase, background: "var(--le-nav-bg)" };

  // In default (translucent) mode the bar colour follows the theme, so the
  // logo must invert with it: light/white logo on the dark bar, dark-ink logo
  // on the light bar. Solid mode always sits on --le-bg, same rule applies.
  const logoVariant = theme === "dark" ? "light" : "dark";

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

