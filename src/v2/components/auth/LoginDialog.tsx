import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";

type Mode = "password" | "magic";

export interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--le-font-mono)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.55)",
};

const labelStyle: React.CSSProperties = {
  ...eyebrowStyle,
  display: "block",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(220,230,255,0.18)",
  borderRadius: 4,
  color: "#fff",
  fontFamily: "var(--le-font-sans)",
  fontSize: 14,
  height: 46,
  padding: "0 14px 0 42px",
  outline: "none",
  boxSizing: "border-box",
};

/**
 * LoginDialog — editorial modal mirroring the Hero's dark aesthetic.
 *
 * Primary flow: email + password (Supabase signInWithPassword).
 * Secondary flow: one-time magic link (signInWithMagicLink).
 *
 * Mounts into document.body via a portal so it can appear over any
 * route and stack cleanly above navs, images, and page content.
 */
export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { signInWithMagicLink, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // Reset transient state when the dialog is re-opened after a close.
  useEffect(() => {
    if (open) {
      setError("");
      setSubmitting(false);
      setSent(false);
    }
  }, [open]);

  // Lock scroll + escape-to-close when open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "password") {
        await signInWithPassword(email, password);
        // Auth listener fires Navigate in Login.tsx / AuthProvider;
        // close the dialog optimistically.
        onClose();
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

  if (typeof document === "undefined") return null;

  const canSubmit =
    email.trim().length > 0 && (mode === "magic" || password.length > 0);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="login-dialog-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          {/* Backdrop */}
          <div
            onClick={onClose}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(5,7,14,0.72)",
              backdropFilter: "blur(10px) saturate(1.2)",
              WebkitBackdropFilter: "blur(10px) saturate(1.2)",
            }}
          />

          {/* Dialog card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-heading"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 440,
              background: "#0b0f1c",
              border: "1px solid rgba(220,230,255,0.14)",
              borderRadius: 4,
              padding: "40px 40px 32px",
              color: "#fff",
              boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sign in"
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                width: 32,
                height: 32,
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.55)",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              <X style={{ width: 16, height: 16 }} />
            </button>

            {/* Logo */}
            <div style={{ marginBottom: 28 }}>
              <LELogoMark size={30} variant="light" />
            </div>

            {sent ? (
              <>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    border: "1px solid rgba(220,230,255,0.22)",
                    background: "rgba(255,255,255,0.06)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 20,
                  }}
                >
                  <CheckCircle2
                    style={{ width: 18, height: 18, color: "#fff" }}
                    strokeWidth={1.5}
                  />
                </div>
                <h2
                  id="login-heading"
                  style={{
                    fontSize: 24,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    margin: 0,
                    color: "#fff",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  Check your inbox.
                </h2>
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 14,
                    color: "rgba(255,255,255,0.62)",
                    lineHeight: 1.55,
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
                    setPassword("");
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
              </>
            ) : (
              <>
                <span style={eyebrowStyle}>— Sign in</span>
                <h2
                  id="login-heading"
                  style={{
                    marginTop: 12,
                    marginBottom: 6,
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: "-0.035em",
                    color: "#fff",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  Welcome back.
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.62)",
                    lineHeight: 1.55,
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  {mode === "password"
                    ? "Enter your email and password."
                    : "We'll send a one-time link to your inbox."}
                </p>

                <form
                  onSubmit={handleSubmit}
                  style={{
                    marginTop: 28,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div>
                    <label htmlFor="login-email" style={labelStyle}>
                      Email
                    </label>
                    <div style={{ position: "relative" }}>
                      <Mail
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: 14,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 16,
                          height: 16,
                          color: "rgba(255,255,255,0.35)",
                          pointerEvents: "none",
                        }}
                      />
                      <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@brokerage.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoFocus
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {mode === "password" && (
                    <div>
                      <label htmlFor="login-password" style={labelStyle}>
                        Password
                      </label>
                      <div style={{ position: "relative" }}>
                        <Lock
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: 14,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 16,
                            height: 16,
                            color: "rgba(255,255,255,0.35)",
                            pointerEvents: "none",
                          }}
                        />
                        <input
                          id="login-password"
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      style={{
                        border: "1px solid rgba(255,80,80,0.4)",
                        background: "rgba(255,80,80,0.08)",
                        padding: 12,
                        borderRadius: 4,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "rgba(255,140,140,0.95)",
                          fontFamily: "var(--le-font-sans)",
                        }}
                      >
                        {error}
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || !canSubmit}
                    style={{
                      width: "100%",
                      marginTop: 4,
                      background:
                        submitting || !canSubmit
                          ? "rgba(255,255,255,0.28)"
                          : "#fff",
                      color: "#07080c",
                      border: "none",
                      padding: "12px 20px",
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 4,
                      cursor:
                        submitting || !canSubmit ? "not-allowed" : "pointer",
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
                      marginTop: 4,
                    }}
                  >
                    {mode === "password"
                      ? "Email me a magic link instead"
                      : "Sign in with password instead"}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
