import "@/v2/styles/v2.css";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--le-font-mono)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.55)",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(220,230,255,0.18)",
  borderRadius: 4,
  color: "#fff",
  fontFamily: "var(--le-font-sans)",
  height: 48,
};

type Mode = "password" | "magic";

export default function Login() {
  const { user, profile, loading, signInWithMagicLink, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    if (profile?.role === "admin") return <Navigate to="/dashboard" replace />;
    return <Navigate to="/account" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "password") {
        await signInWithPassword(email, password);
        // Auth state listener will redirect via the Navigate above.
      } else {
        await signInWithMagicLink(email);
        setSent(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "password"
          ? "Sign in failed"
          : "Failed to send magic link",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        minHeight: "100vh",
        gridTemplateColumns: "1fr 1fr",
        background: "#050710",
        color: "#fff",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      {/* Left — editorial copy panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderRight: "1px solid rgba(220,230,255,0.09)",
          background: "#0b0f1c",
          padding: "48px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background image */}
        <img
          src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80"
          alt=""
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "brightness(0.25)",
            pointerEvents: "none",
          }}
        />

        {/* Top-left logo — matches the Hero nav placement */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <Link
            to="/"
            style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
          >
            <LELogoMark size={38} variant="light" />
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.1 }}
          style={{ maxWidth: 400, position: "relative", zIndex: 1 }}
        >
          <span style={eyebrowStyle}>— Listing Elevate</span>
          <h1
            style={{
              fontSize: "clamp(40px, 5vw, 64px)",
              fontWeight: 500,
              letterSpacing: "-0.035em",
              lineHeight: 0.98,
              margin: "24px 0 0",
              color: "#fff",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Cinema for
            <br />
            <span style={{ color: "rgba(255,255,255,0.45)" }}>every listing.</span>
          </h1>
          <p
            style={{
              marginTop: 32,
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.62)",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Sign in to access your video library, manage in-flight productions, and submit new listings.
          </p>
        </motion.div>

        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "rgba(255,255,255,0.55)",
            textDecoration: "none",
            fontSize: 12,
            fontFamily: "var(--le-font-mono)",
            letterSpacing: "0.1em",
            position: "relative",
            zIndex: 1,
          }}
        >
          <ArrowLeft style={{ width: 12, height: 12 }} /> Back to home
        </Link>
      </div>

      {/* Right — form */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 64px",
          background: "#050710",
          fontFamily: "var(--le-font-sans)",
        }}
      >
        {/* No duplicate logo header — left panel owns the brand on this page */}
        <div />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
          style={{
            width: "100%",
            maxWidth: 360,
            flexShrink: 0,
            alignSelf: "center",
          }}
        >
          <span style={eyebrowStyle}>— Sign in</span>
          <h2
            style={{
              fontSize: 32,
              fontWeight: 500,
              letterSpacing: "-0.035em",
              margin: "16px 0 0",
              color: "#fff",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Welcome back.
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.62)",
              marginTop: 12,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            {mode === "password"
              ? "Enter your email and password."
              : "We'll send a one-time link to your inbox."}
          </p>

          {sent ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
              style={{
                marginTop: 48,
                border: "1px solid rgba(220,230,255,0.18)",
                background: "rgba(255,255,255,0.04)",
                padding: 32,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 48,
                  height: 48,
                  border: "1px solid rgba(220,230,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 0,
                }}
              >
                <CheckCircle2 style={{ width: 20, height: 20, color: "#fff" }} strokeWidth={1.5} />
              </div>
              <h3
                style={{
                  marginTop: 24,
                  fontSize: 18,
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                  color: "#fff",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Check your inbox.
              </h3>
              <p
                style={{
                  marginTop: 12,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.62)",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Magic link sent to{" "}
                <span style={{ fontWeight: 500, color: "#fff" }}>{email}</span>. Click it to sign in.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setEmail("");
                }}
                style={{
                  marginTop: 24,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Use a different email
              </button>
            </motion.div>
          ) : (
            <form
              onSubmit={handleSubmit}
              style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 20 }}
            >
              <div>
                <Label
                  htmlFor="email"
                  style={{
                    fontFamily: "var(--le-font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.55)",
                  }}
                >
                  Email
                </Label>
                <div style={{ position: "relative", marginTop: 12 }}>
                  <Mail
                    style={{
                      pointerEvents: "none",
                      position: "absolute",
                      left: 16,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 16,
                      color: "rgba(255,255,255,0.32)",
                    }}
                  />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@brokerage.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="pl-11"
                    style={inputStyle}
                  />
                </div>
              </div>

              {mode === "password" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                    }}
                  >
                    <Label
                      htmlFor="password"
                      style={{
                        fontFamily: "var(--le-font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: "rgba(255,255,255,0.55)",
                      }}
                    >
                      Password
                    </Label>
                  </div>
                  <div style={{ position: "relative", marginTop: 12 }}>
                    <Lock
                      style={{
                        pointerEvents: "none",
                        position: "absolute",
                        left: 16,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 16,
                        height: 16,
                        color: "rgba(255,255,255,0.32)",
                      }}
                    />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-11"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    border: "1px solid rgba(255,80,80,0.4)",
                    background: "rgba(255,80,80,0.08)",
                    padding: 16,
                    borderRadius: 4,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      color: "rgba(255,120,120,0.9)",
                      margin: 0,
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !email || (mode === "password" && !password)}
                style={{
                  width: "100%",
                  background:
                    submitting || !email || (mode === "password" && !password)
                      ? "rgba(255,255,255,0.3)"
                      : "#fff",
                  color: "#07080c",
                  border: "none",
                  padding: "14px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 4,
                  cursor:
                    submitting || !email || (mode === "password" && !password)
                      ? "not-allowed"
                      : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontFamily: "var(--le-font-sans)",
                  letterSpacing: "-0.005em",
                  transition: "background 0.15s ease",
                }}
              >
                {submitting ? (
                  <>
                    <Loader2
                      style={{
                        width: 16,
                        height: 16,
                        animation: "spin 1s linear infinite",
                      }}
                    />{" "}
                    {mode === "password" ? "Signing in" : "Sending"}
                  </>
                ) : mode === "password" ? (
                  <>
                    Sign in <ArrowRight style={{ width: 16, height: 16 }} />
                  </>
                ) : (
                  <>
                    Send magic link <ArrowRight style={{ width: 16, height: 16 }} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError("");
                  setMode(mode === "password" ? "magic" : "password");
                }}
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  background: "none",
                  border: "none",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--le-font-sans)",
                  alignSelf: "center",
                }}
              >
                {mode === "password" ? "Email me a magic link instead" : "Sign in with password instead"}
              </button>

              <p
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.45)",
                  textAlign: "center",
                  marginTop: 8,
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Don't have an account?{" "}
                <Link
                  to="/"
                  style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: 4 }}
                >
                  Sign up on the home page
                </Link>
              </p>
            </form>
          )}
        </motion.div>

        <p
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.32)",
            marginTop: 48,
            fontFamily: "var(--le-font-mono)",
          }}
        >
          © 2026 Listing Elevate
        </p>
      </div>
    </div>
  );
}
