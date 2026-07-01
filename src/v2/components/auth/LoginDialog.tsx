import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Mail,
  Lock,
  User,
  Building2,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { SocialAuthButtons } from "@/v2/components/auth/SocialAuthButtons";
import { passwordIssue } from "@/lib/passwordUtils";

type AuthMode = "signin" | "signup";
// "form" → credentials step; "sent" → magic link sent; "confirm" → sign-up confirmation
type Step = "form" | "sent" | "confirm";

export interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Animation duration for the card entry (ms). Focus is deferred until after
// this completes so the browser scroll-to-focused-element doesn't fight the
// y-translate, which was the source of the visible animation glitch.
const ENTRY_MS = 300;

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

const iconStyle: React.CSSProperties = {
  position: "absolute",
  left: 14,
  top: "50%",
  transform: "translateY(-50%)",
  width: 16,
  height: 16,
  color: "var(--le-text-faint)",
  pointerEvents: "none",
};

// Neutral/secondary text-link (password toggle, sign-in/sign-up switch, "use a
// different email"). Never the accent — the filled primary is the only accent.
const switchLinkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--le-text)",
  fontWeight: 500,
  fontSize: 13,
  textDecoration: "underline",
  textUnderlineOffset: 4,
  fontFamily: "var(--le-font-sans)",
};

type TextFieldProps = {
  id: string;
  label: string;
  icon: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>;

/** Label + icon-prefixed input, matching the dialog's inline-style token pattern. */
function TextField({ id, label, icon, ...rest }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="le-eyebrow" style={labelStyle}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        {icon}
        <input id={id} style={inputStyle} {...rest} />
      </div>
    </div>
  );
}

/** "or" rule — thin border lines flanking a centered lowercase eyebrow. */
function OrDivider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, height: 1, background: "var(--le-border)" }} />
      <span
        className="le-eyebrow"
        style={{ textTransform: "none", color: "var(--le-text-faint)" }}
      >
        or
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--le-border)" }} />
    </div>
  );
}

/**
 * LoginDialog — unified sign-in / sign-up modal on the light SaaS surface.
 *
 * Sign in: social (Google) → magic link (primary, default) or an
 * optional password. Sign up: social → name / brokerage / email / password
 * (validated via passwordIssue) → confirmation.
 *
 * Mounts into document.body via a portal so it can appear over any route and
 * stack cleanly above navs, images, and page content.
 *
 * Animation notes (2026-06-11): `autoFocus` on the email input fired
 * synchronously on mount, triggering the browser's "scroll to focused element"
 * while the framer-motion y-translate entry animation (ENTRY_MS) was still
 * running — the two transforms fought and produced a visible glitch. The fixes,
 * preserved here:
 *   - `autoFocus` removed; a deferred `.focus()` runs after the entry animation.
 *   - The password field is wrapped in AnimatePresence + motion.div so its
 *     mount/unmount transitions height smoothly instead of jumping the card.
 *   - The form/sent/confirm swap uses AnimatePresence mode="wait" so the steps
 *     cross-fade rather than swapping instantly.
 */
export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const {
    signInWithMagicLink,
    signInWithPassword,
    signUp,
  } = useAuth();

  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [usePassword, setUsePassword] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Element focused before the dialog opened — restored on close so focus
  // doesn't get dropped back to <body> (standard modal a11y behavior).
  const prevFocusRef = useRef<Element | null>(null);

  // Reset transient state when the dialog is re-opened after a close. Also
  // clears every credential/profile field and mode toggle: the dialog stays
  // mounted across opens (only `open` flips), so without this a value typed
  // in a previous session (e.g. a password) would silently persist into the
  // next one.
  useEffect(() => {
    if (open) {
      setError("");
      setSubmitting(false);
      setStep("form");
      setPassword("");
      setEmail("");
      setFirstName("");
      setLastName("");
      setBrokerage("");
      setUsePassword(false);
      setAuthMode("signin");
    }
  }, [open]);

  // Capture the previously-focused element on open, restore it on close —
  // standard modal focus-restore behavior.
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
    } else if (
      prevFocusRef.current instanceof HTMLElement &&
      document.body.contains(prevFocusRef.current)
    ) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  // Clear stale errors when the user switches sign-in/sign-up or toggles the
  // password affordance — a message about the old path shouldn't linger.
  useEffect(() => {
    setError("");
  }, [authMode, usePassword]);

  // Deferred focus: wait until the entry animation completes before moving
  // focus into the email field. Firing autoFocus synchronously on mount
  // triggered browser scroll mid-animation, causing the glitch.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (step === "form") emailRef.current?.focus();
    }, ENTRY_MS);
    return () => clearTimeout(t);
  }, [open, step]);

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

  // Google sign-in is the GSI ID-token flow (see SocialAuthButtons /
  // @/lib/googleIdentity) — the credential exchange and its
  // `supabase.auth.signInWithIdToken` call happen entirely inside that
  // component; this dialog only reacts to the two outcomes it reports.
  function handleGoogleSuccess() {
    setError("");
    onClose();
  }

  function handleGoogleError(message: string) {
    setError(message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (authMode === "signup") {
      // Validate before touching the network; keep submitting=false on early out.
      const issue = passwordIssue(password);
      if (issue) {
        setError(issue);
        return;
      }
      setSubmitting(true);
      try {
        const meta: {
          first_name?: string;
          last_name?: string;
          brokerage?: string;
        } = {};
        if (firstName.trim()) meta.first_name = firstName.trim();
        if (lastName.trim()) meta.last_name = lastName.trim();
        if (brokerage.trim()) meta.brokerage = brokerage.trim();
        await signUp(email.trim(), password, meta);
        setStep("confirm");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create account");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Sign in.
    setSubmitting(true);
    try {
      if (usePassword) {
        await signInWithPassword(email.trim(), password);
        // Auth state listener handles redirect.
        onClose();
      } else {
        await signInWithMagicLink(email.trim());
        setStep("sent");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : usePassword
          ? "Sign in failed"
          : "Failed to send magic link",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Tab-trap: keeps focus cycling within the dialog while it's open. Escape
  // handling stays on the document-level listener above (separate concern) —
  // this is additive, dialog-scoped keydown for Tab only. Deliberately
  // attribute-based (`:not([disabled])`, `:not([hidden])`) rather than
  // offsetParent/layout-based — jsdom has no layout engine, so a
  // visibility check via offsetParent is always null there and would make
  // the focusable set always empty, breaking tests.
  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href]:not([hidden]), button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([disabled]):not([hidden])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (typeof document === "undefined") return null;

  const isSignup = authMode === "signup";

  const canSubmit =
    email.trim().length > 0 &&
    (!isSignup && !usePassword ? true : password.length > 0);

  // Primary-button copy, per mode/state.
  const idleLabel = isSignup
    ? "Create account"
    : usePassword
    ? "Sign in"
    : "Send magic link";
  const busyLabel = isSignup
    ? "Creating account"
    : usePassword
    ? "Signing in"
    : "Sending";

  const eyebrow = isSignup ? "— Get started" : "— Sign in";
  const heading = isSignup ? "Create your account." : "Welcome back.";
  const subcopy = isSignup
    ? "Tell us a little about yourself to get started."
    : usePassword
    ? "Enter your email and password."
    : "We'll email you a one-time sign-in link.";

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-heading"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: ENTRY_MS / 1000, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 440,
              maxHeight: "calc(100vh - 48px)",
              overflowY: "auto",
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

            {/* Step swap — cross-fade so content doesn't pop */}
            <AnimatePresence mode="wait" initial={false}>
              {step === "sent" || step === "confirm" ? (
                /* ── Success step (magic link sent / sign-up confirmation) ── */
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
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
                    {step === "confirm" ? "Confirm your email." : "Check your inbox."}
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
                    {step === "confirm" ? (
                      <>
                        We sent a confirmation link to{" "}
                        <span style={{ fontWeight: 500, color: "var(--le-text)" }}>
                          {email}
                        </span>
                        . Click it to finish creating your account.
                      </>
                    ) : (
                      <>
                        Magic link sent to{" "}
                        <span style={{ fontWeight: 500, color: "var(--le-text)" }}>
                          {email}
                        </span>
                        . Click it to sign in.
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("form");
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
                </motion.div>
              ) : (
                /* ── Credentials form step (sign in / sign up) ── */
                <motion.div
                  key="form"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <span className="le-eyebrow">{eyebrow}</span>
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
                    {heading}
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
                    {subcopy}
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
                    {/* Social providers */}
                    <SocialAuthButtons
                      onGoogleSuccess={handleGoogleSuccess}
                      onGoogleError={handleGoogleError}
                      disabled={submitting}
                    />

                    <OrDivider />

                    {/* Shared error surface — sits above the email field so the
                        OAuth "use email below" copy reads correctly. */}
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

                    {isSignup ? (
                      /* ── Sign-up fields ── */
                      <>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <TextField
                            id="signup-first-name"
                            label="First name"
                            icon={<User aria-hidden="true" style={iconStyle} />}
                            type="text"
                            autoComplete="given-name"
                            placeholder="Jane"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                          />
                          <TextField
                            id="signup-last-name"
                            label="Last name"
                            icon={<User aria-hidden="true" style={iconStyle} />}
                            type="text"
                            autoComplete="family-name"
                            placeholder="Doe"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                          />
                        </div>

                        <TextField
                          id="signup-brokerage"
                          label="Brokerage"
                          icon={<Building2 aria-hidden="true" style={iconStyle} />}
                          type="text"
                          autoComplete="organization"
                          placeholder="Acme Realty"
                          value={brokerage}
                          onChange={(e) => setBrokerage(e.target.value)}
                        />

                        <TextField
                          id="signup-email"
                          label="Email"
                          icon={<Mail aria-hidden="true" style={iconStyle} />}
                          type="email"
                          autoComplete="email"
                          placeholder="you@brokerage.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />

                        <TextField
                          id="signup-password"
                          label="Password"
                          icon={<Lock aria-hidden="true" style={iconStyle} />}
                          type="password"
                          autoComplete="new-password"
                          placeholder="At least 10 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </>
                    ) : (
                      /* ── Sign-in fields ── */
                      <>
                        <div>
                          <label
                            htmlFor="login-email"
                            className="le-eyebrow"
                            style={labelStyle}
                          >
                            Email
                          </label>
                          <div style={{ position: "relative" }}>
                            <Mail aria-hidden="true" style={iconStyle} />
                            <input
                              id="login-email"
                              ref={emailRef}
                              type="email"
                              autoComplete="email"
                              placeholder="you@brokerage.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              required
                              // autoFocus intentionally omitted — see deferred focus
                              // effect above. Firing autoFocus synchronously on mount
                              // caused the browser to scroll mid-animation.
                              data-autofocus-deferred="true"
                              style={inputStyle}
                            />
                          </div>
                        </div>

                        {/* Password — height-animated so its mount/unmount doesn't
                            jump the card. No minLength / passwordIssue: legacy
                            sign-in passwords predate the current policy. */}
                        <AnimatePresence initial={false}>
                          {usePassword && (
                            <motion.div
                              key="password-field"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.22, ease: EASE }}
                              style={{ overflow: "hidden" }}
                            >
                              <label
                                htmlFor="login-password"
                                className="le-eyebrow"
                                style={labelStyle}
                              >
                                Password
                              </label>
                              <div style={{ position: "relative" }}>
                                <Lock aria-hidden="true" style={iconStyle} />
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
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </>
                    )}

                    {/* Primary submit — the modal's single accent */}
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
                          {busyLabel}
                        </>
                      ) : (
                        <>
                          {idleLabel}{" "}
                          <ArrowRight style={{ width: 16, height: 16 }} />
                        </>
                      )}
                    </button>

                    {/* Password / magic-link toggle — sign-in only */}
                    {!isSignup && (
                      <button
                        type="button"
                        onClick={() => setUsePassword((v) => !v)}
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
                        {usePassword
                          ? "Email me a magic link instead"
                          : "Use a password instead"}
                      </button>
                    )}
                  </form>

                  {/* Sign-in ↔ sign-up switch */}
                  <p
                    style={{
                      marginTop: 24,
                      marginBottom: 0,
                      fontSize: 13,
                      color: "var(--le-text-muted)",
                      textAlign: "center",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {isSignup ? (
                      <>
                        Already have an account?{" "}
                        <button
                          type="button"
                          onClick={() => setAuthMode("signin")}
                          style={switchLinkStyle}
                        >
                          Sign in
                        </button>
                      </>
                    ) : (
                      <>
                        New to Listing Elevate?{" "}
                        <button
                          type="button"
                          onClick={() => setAuthMode("signup")}
                          style={switchLinkStyle}
                        >
                          Create an account
                        </button>
                      </>
                    )}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
