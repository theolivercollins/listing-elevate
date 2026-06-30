import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

// ─── MfaChallengeWall ─────────────────────────────────────────────────────────
// Full-page gate that renders when the session is aal1 but a verified TOTP
// factor exists (nextLevel === 'aal2'). Blocks all dashboard content until
// the user enters a valid code from their authenticator app.
// After completeMfaChallenge() resolves, mfaRequired becomes false and
// RequireAuth re-renders to show the Outlet normally.
//
// TODO (server-side follow-up): enforce AAL on api/admin routes by checking
// the `aal` claim in the JWT. v1 is purely client-side — a motivated actor
// with a stolen aal1 access token could hit server routes directly. To close
// that gap, verify `session.user.factors` AAL in the API middleware.

const wallInputCls =
  "w-full text-center text-[20px] tracking-[0.3em] py-[11px] px-[14px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] outline-none font-[inherit] box-border tabular-nums";

const wallHintCls = "text-[12px] text-[var(--muted)] leading-[1.5]";

function MfaChallengeWall() {
  const { completeMfaChallenge } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError("");
    setSubmitting(true);
    try {
      await completeMfaChallenge(code);
      // mfaRequired becomes false → RequireAuth re-renders → Outlet shows
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace("Invalid MFA code", "Incorrect code — try again")
          : "Incorrect code — try again"
      );
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg, #f5f6f8)" }}
    >
      <div
        className="le-card"
        style={{ padding: 32, width: "100%", maxWidth: 380 }}
      >
        {/* Shield icon — inline SVG, not in the dashboard icon set */}
        <div
          style={{
            width: 44,
            height: 44,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
            borderRadius: "var(--le-r-lg)",
            marginBottom: 20,
          }}
        >
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>

        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
          }}
        >
          Verify your identity
        </h2>
        <p className={wallHintCls} style={{ marginBottom: 24 }}>
          Enter the 6-digit code from your authenticator app to continue.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label
              htmlFor="mfa-wall-code"
              className="block text-[12px] font-medium text-[var(--muted)] mb-1.5"
            >
              Authenticator code
            </label>
            <input
              id="mfa-wall-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className={wallInputCls}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-[12px] leading-[1.5]"
              style={{ color: "var(--bad)", margin: 0 }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="le-btn-dark text-[13px] py-2.5 px-5"
            disabled={code.length !== 6 || submitting}
            style={
              code.length !== 6 || submitting ? { opacity: 0.6 } : undefined
            }
          >
            {submitting ? "Verifying..." : "Verify"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── RequireAuth ──────────────────────────────────────────────────────────────

export function RequireAuth() {
  const { user, loading, mfaRequired = false } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // User is signed in but has a verified TOTP factor that hasn't been
  // challenged yet this session (aal1 with nextLevel=aal2). Block the entire
  // app until they complete the challenge.
  if (mfaRequired) return <MfaChallengeWall />;

  return <Outlet />;
}

// ─── RequireAdmin ─────────────────────────────────────────────────────────────

export function RequireAdmin() {
  const { user, profile, loading, mfaVerifiedFactors = [] } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role !== "admin") return <Navigate to="/dashboard" replace />;

  // Admins must have at least one verified TOTP factor. If they've reached
  // this point without one (e.g. existing admin who hasn't enrolled yet),
  // redirect them to the profile page with a setup prompt.
  //
  // Note: if the admin HAS a factor but this session is aal1, RequireAuth
  // (which wraps RequireAdmin in the route tree) will have already shown
  // the MfaChallengeWall before this component renders — so we only reach
  // this check for the "no factor at all" case.
  //
  // TODO (server-side follow-up): additionally enforce the `aal` claim on
  // /api/admin/* routes. Client-side gating is defence-in-depth only — a
  // stolen aal1 token bypasses it. See docs/security/mfa-server-followup.md.
  if (mfaVerifiedFactors.length === 0) {
    return <Navigate to="/dashboard/account/profile?mfa_setup=1" replace />;
  }

  return <Outlet />;
}
