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

// Layout-only addition on top of className="le-eyebrow" for form labels.
const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--le-bg)",
  border: "1px solid var(--le-border-strong)",
  borderRadius: 4,
  color: "var(--le-text)",
  fontFamily: "var(--le-font-sans)",
  fontSize: 14,
  height: 46,
  padding: "0 14px 0 42px",
  outline: "none",
  boxSizing: "border-box",
};

/**
 * LoginDialog — light modal matching the SaaS surface (2026-06-11).
 *
 * Primary flow: email + password (Supabase signInWithPassword).
 * Secondary flow: one-time magic link (signInWithMagicLink).
 *
 * Mounts into document.body via a portal so it can appear over any
 * route and stack cleanly above navs, images, and page content.
 * Dark-pin removed — dialog inherits the global theme.
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
              background: "rgba(7,8,12,0.4)",
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
              background: "var(--le-bg)",
              border: "1px solid var(--le-border)",
              borderRadius: 16,
              padding: "40px 40px 32px",
              color: "var(--le-text)",
              boxShadow: "var(--le-shadow-lg)",
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
                color: "var(--le-text-faint)",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              <X style={{ width: 16, height: 16 }} />
            </button>

            {/* Logo */}
            <div style={{ marginBottom: 28 }}>
              <LELogoMark size={30} variant="dark" />
            </div>

            {sent ? (
              <>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    border: "1px solid var(--le-border-strong)",
                    background: "var(--le-bg-sunken)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 20,
                  }}
                >
                  <CheckCircle2
                    style={{ width: 18, height: 18, color: "var(--le-text)" }}
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
                    color: "var(--le-text)",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  Check your inbox.
                </h2>
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 14,
                    color: "var(--le-text-muted)",
                    lineHeight: 1.55,
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  Magic link sent to{" "}
                  <span style={{ fontWeight: 500, color: "var(--le-text)" }}>{email}</span>. Click it to sign in.
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
                    color: "var(--le-text-muted)",
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
                <span className="le-eyebrow">— Sign in</span>
                <h2
                  id="login-heading"
                  style={{
                    marginTop: 12,
                    marginBottom: 6,
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: "-0.035em",
                    color: "var(--le-text)",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  Welcome back.
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--le-text-muted)",
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
                    <label htmlFor="login-email" className="le-eyebrow" style={labelStyle}>
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
                          color: "var(--le-text-faint)",
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
                      <label htmlFor="login-password" className="le-eyebrow" style={labelStyle}>
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
                            color: "var(--le-text-faint)",
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
                        border: "1px solid var(--le-danger)",
                        background: "var(--le-danger-soft)",
                        padding: 12,
                        borderRadius: 4,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "var(--le-danger)",
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
                          ? "var(--le-bg-sunken)"
                          : "var(--le-accent)",
                      color: "var(--le-accent-fg)",
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
                      color: "var(--le-text-muted)",
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
