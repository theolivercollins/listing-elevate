import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { LEButton } from "@/v2/components/primitives/LEButton";
import { SocialAuthButtons } from "@/v2/components/auth/SocialAuthButtons";
import "./login-dialog.css";

export interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type Flow = "signin" | "signup";
type Step =
  // sign-in
  | "email"
  | "choose"
  | "password"
  | "sent"
  // signup
  | "verify"
  | "newpw"
  | "welcome"
  | "profile"
  | "role"
  | "source"
  // shared terminal
  | "done";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const ENTRY_MS = 300;

// The design's rgb(47,109,240) === #2f6df0 === var(--le-tile-sky-ink); its rgba
// variants map to rgba(var(--le-brand-blue-rgb), a). Both tokens exist in
// tokens.css, so we prefer them over raw literals.
const BLUE = "var(--le-tile-sky-ink)";

const PERSONAS = [
  { id: "agent", label: "Agent", sub: "Independent or with a team", icon: "M12 3 3 8v13h6v-7h6v7h6V8z" },
  {
    id: "team_leader",
    label: "Team leader",
    sub: "Runs a producing team",
    icon: "M17 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM7 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM2 21v-2a5 5 0 0 1 5-5h1a5 5 0 0 1 3 1M13 21v-2a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v2z",
  },
  { id: "broker", label: "Broker", sub: "Owns or manages a brokerage", icon: "M4 21V8l8-5 8 5v13M9 21v-6h6v6" },
  {
    id: "marketing",
    label: "Marketing",
    sub: "Handles content & campaigns",
    icon: "M4 11v2a1 1 0 0 0 1 1h2l5 4V6L7 10H5a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8",
  },
] as const;

type PersonaId = (typeof PERSONAS)[number]["id"];

const SOURCES = [
  { id: "search", label: "A search engine", subs: ["Google", "Bing", "Yahoo", "DuckDuckGo"] },
  { id: "social", label: "Social media", subs: ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube"] },
  { id: "ai", label: "An AI assistant", subs: ["ChatGPT", "Claude", "Gemini", "Perplexity"] },
  { id: "referral", label: "Referral from a colleague", subs: [] as string[] },
  { id: "event", label: "An industry event", subs: [] as string[] },
  { id: "other", label: "Somewhere else", subs: [] as string[] },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOk = (v: string) => EMAIL_RE.test(v.trim());
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function pwChecks(pw: string) {
  const criteria = [
    { label: "At least 8 characters", ok: pw.length >= 8 },
    { label: "Upper & lowercase letters", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "A number", ok: /[0-9]/.test(pw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
  const met = criteria.filter((c) => c.ok).length;
  const score = Math.min(met + (pw.length >= 12 ? 1 : 0), 4);
  let label = "";
  let color = "var(--le-danger)";
  if (pw.length > 0) {
    if (score <= 1) {
      label = "Weak";
      color = "var(--le-danger)";
    } else if (score <= 3) {
      label = "Medium";
      color = "var(--le-warn)";
    } else {
      label = "Strong";
      color = "var(--le-success)";
    }
  }
  return { criteria, pct: pw.length ? Math.max((score / 4) * 100, 10) : 0, label, color, valid: pw.length >= 8 };
}

// ── Inline icons (match the design's raw SVGs; no lucide) ────────────────────
const MailIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3.5 7.5 8.5 5.5 8.5-5.5" />
  </svg>
);
const ArrowIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const ChevronIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
);
const LockIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const SparkleIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" />
  </svg>
);
const CheckIcon = ({ size = 10, stroke = "currentColor", sw = 3 }: { size?: number; stroke?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);
const XIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const PathIcon = ({ d, size = 17 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const LightSpinner = ({ size = 15 }: { size?: number }) => (
  <span
    className="le-login-spin"
    style={{
      width: size,
      height: size,
      border: "2px solid rgba(255,255,255,.4)",
      borderTopColor: "#fff",
      borderRadius: "50%",
      display: "inline-block",
    }}
  />
);
const InkSpinner = ({ size = 14 }: { size?: number }) => (
  <span
    className="le-login-spin"
    style={{
      width: size,
      height: size,
      border: "2px solid var(--le-border-strong)",
      borderTopColor: "var(--le-text)",
      borderRadius: "50%",
      display: "inline-block",
    }}
  />
);

// ── Shared style helpers ─────────────────────────────────────────────────────
const linkBtnStyle = (size: number): CSSProperties => ({
  border: "none",
  background: "none",
  padding: 0,
  fontFamily: "var(--le-font-sans)",
  fontWeight: 600,
  fontSize: size,
  color: BLUE,
  cursor: "pointer",
});
const headingStyle: CSSProperties = { fontSize: 23, fontWeight: 600, letterSpacing: "-0.028em", lineHeight: 1.15 };
const subStyle: CSSProperties = { fontSize: 14, color: "var(--le-text-muted)", marginTop: 6, lineHeight: 1.5 };
const fieldLabelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, color: "var(--le-text)" };
const fieldInputStyle: CSSProperties = {
  width: "100%",
  height: 44,
  boxSizing: "border-box",
  padding: "0 13px",
  fontSize: 14,
  color: "var(--le-text)",
  background: "#fff",
  border: "1px solid var(--le-border-strong)",
  borderRadius: "var(--le-r-md)",
  fontFamily: "var(--le-font-sans)",
  outline: "none",
};

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <LEButton
      variant="primary"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      style={{ width: "100%", padding: "13px 20px", fontSize: 14.5, fontWeight: 600 }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {loading && <LightSpinner />}
        {children}
      </span>
    </LEButton>
  );
}

const NOISE_BG =
  "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22140%22 height=%22140%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22140%22 height=%22140%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')";

/**
 * LoginDialog — "Immersive Login 5a": one dialog, both flows.
 *
 * A full-viewport immersive overlay (radial backdrop + drifting parallax orbs +
 * dim layer) holding a 448px white card that tilts toward the cursor and carries
 * a navy gradient header. Sign-in: email → choose (password / magic link) →
 * password or sent. Signup: email → verify (OTP) → create password → welcome →
 * profile → persona → source → done.
 *
 * Public API and portal/overlay pattern are unchanged so LoginDialogContext and
 * every CTA keep working. Real auth via useAuth(); Google via SocialAuthButtons.
 */
export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const {
    signInWithMagicLink,
    signInWithPassword,
    sendSignupCode,
    verifySignupCode,
    fetchProfileSnapshot,
    setPassword: applyPassword,
    completeOnboarding,
    session,
  } = useAuth();

  const reduce = useReducedMotion();

  const [flow, setFlow] = useState<Flow>("signin");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [sourceCat, setSourceCat] = useState<string | null>(null);
  const [sourceSub, setSourceSub] = useState<string | null>(null);
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [codeStage, setCodeStage] = useState<"idle" | "confirming" | "verified">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ title: string; sub: string }>({
    title: "You're in",
    sub: "Taking you to your workspace…",
  });

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const newPwRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const codeInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const prevFocusRef = useRef<Element | null>(null);
  const advancedRef = useRef(false);
  const doneTimerRef = useRef<number | null>(null);
  const advanceRef = useRef<(userId: string) => void>(() => {});
  // Whether a session already existed when the verify step was entered. When
  // true (user was already authed), the session-watch effect must NOT auto-advance
  // — otherwise an already-signed-in user reaching verify flashes straight through.
  const sessionAtVerifyEntryRef = useRef(false);

  const isSignup = flow === "signup";
  const chk = pwChecks(password);

  // Reset all transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setFlow("signin");
    setStep("email");
    setEmail("");
    setPasswordValue("");
    setShowPw(false);
    setFirstName("");
    setLastName("");
    setBrokerage("");
    setPersona(null);
    setSourceCat(null);
    setSourceSub(null);
    setCode(["", "", "", "", "", ""]);
    setCodeStage("idle");
    setLoading(false);
    setError("");
    advancedRef.current = false;
    sessionAtVerifyEntryRef.current = false;
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
  }, [open]);

  // Capture/restore focus around the modal.
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
    } else if (prevFocusRef.current instanceof HTMLElement && document.body.contains(prevFocusRef.current)) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  // Clear stale errors on flow switch.
  useEffect(() => {
    setError("");
  }, [flow]);

  // Lock scroll + Escape-to-close while open.
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

  // Deferred, retrying focus into the active step's primary field. Retries via
  // rAF because AnimatePresence mode="wait" mounts the new step after the exit
  // transition, so the target may not exist at the initial ENTRY_MS tick.
  useEffect(() => {
    if (!open) return;
    let tries = 0;
    let raf = 0;
    const target = (): HTMLInputElement | null => {
      switch (step) {
        case "email":
          return emailRef.current;
        case "password":
          return pwRef.current;
        case "newpw":
          return newPwRef.current;
        case "verify":
          return codeInputsRef.current[0] ?? null;
        case "profile":
          return firstNameRef.current;
        default:
          return null;
      }
    };
    const t = window.setTimeout(function attempt() {
      const el = target();
      if (el) {
        el.focus();
        return;
      }
      if (tries++ < 20) raf = requestAnimationFrame(attempt);
    }, ENTRY_MS);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, step]);

  // Mouse parallax (orbs, data-px) + card tilt (data-tilt). rAF-throttled and
  // disabled entirely under prefers-reduced-motion.
  useEffect(() => {
    if (!open || reduce) return;
    const root = overlayRef.current;
    if (!root) return;
    let raf = 0;
    const pos = { px: 0, py: 0 };
    const apply = () => {
      raf = 0;
      root.querySelectorAll<HTMLElement>("[data-px]").forEach((el) => {
        const f = parseFloat(el.dataset.px || "0") || 0;
        el.style.transform = `translate3d(${(-pos.px * f * 130).toFixed(1)}px, ${(-pos.py * f * 130).toFixed(1)}px, 0)`;
      });
      root.querySelectorAll<HTMLElement>("[data-tilt]").forEach((el) => {
        const f = parseFloat(el.dataset.tilt || "1") || 1;
        el.style.transform = `perspective(1400px) rotateY(${(pos.px * 5 * f).toFixed(2)}deg) rotateX(${(-pos.py * 5 * f).toFixed(2)}deg)`;
      });
    };
    const onMove = (e: MouseEvent) => {
      const r = root.getBoundingClientRect();
      pos.px = (e.clientX - r.left) / r.width - 0.5;
      pos.py = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      pos.px = 0;
      pos.py = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, reduce]);

  // Clean up any pending "done → close" timer on unmount.
  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
  }, []);

  function goDone(title: string, sub: string) {
    setDone({ title, sub });
    setStep("done");
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    doneTimerRef.current = window.setTimeout(() => onClose(), 900);
  }

  // Post-verify branch (kept in a ref so both the session-watch effect and the
  // manual OTP submit share one always-fresh implementation — no stale closures).
  // Deterministic: fetch an authoritative profile snapshot for the just-verified
  // user id and branch on THAT — never an ambient profile read, never a timer.
  // A row with a first_name means an existing account (route to done, don't touch
  // the password); no row / empty first_name means a genuinely new signup → newpw.
  advanceRef.current = (userId: string) => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    setCodeStage("verified");
    void fetchProfileSnapshot(userId)
      .then((snapshot) => {
        if (snapshot?.first_name) {
          goDone("You're in", "Taking you to your workspace…");
        } else {
          setStep("newpw");
        }
      })
      .catch((e) => {
        // A failed lookup must NEVER silently fall through to newpw/done — that
        // would risk misclassifying an existing account as new. Surface the
        // error on the verify step and reset the double-fire guard so either
        // path (manual re-submit or the session-watch effect) can retry.
        advancedRef.current = false;
        setCodeStage("idle");
        setError(errMsg(e, "Couldn't confirm your account. Please try again."));
        setCode(["", "", "", "", "", ""]);
        codeInputsRef.current[0]?.focus();
      });
  };

  // Auto-advance when a session appears on the verify step (e.g. the emailed link
  // was opened in this same tab). Only fire on an absent→present transition: if a
  // session already existed when verify was entered, an already-authed user would
  // otherwise flash straight through. Branch on the same deterministic snapshot.
  useEffect(() => {
    if (step !== "verify" || !session) return;
    if (sessionAtVerifyEntryRef.current) return;
    advanceRef.current(session.user.id);
  }, [step, session]);

  // Welcome interstitial → profile.
  useEffect(() => {
    if (step !== "welcome") return;
    const t = window.setTimeout(() => setStep("profile"), 1500);
    return () => clearTimeout(t);
  }, [step]);

  // Auto-submit the OTP once six digits are present.
  useEffect(() => {
    if (step !== "verify" || codeStage !== "idle") return;
    const joined = code.join("");
    if (joined.length === 6) void submitCode(joined);
    // submitCode is stable enough for this trigger; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, codeStage]);

  // ── Google (via SocialAuthButtons — GSI ID-token flow) ─────────────────────
  function handleGoogleSuccess() {
    setError("");
    onClose();
  }
  function handleGoogleError(message: string) {
    setError(message);
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function continueEmail() {
    if (!emailOk(email) || loading) return;
    setError("");
    if (!isSignup) {
      setStep("choose");
      return;
    }
    setLoading(true);
    try {
      await sendSignupCode(email.trim());
      advancedRef.current = false;
      // Record whether a session already existed as we enter verify, so the
      // session-watch effect only auto-advances on a real absent→present flip.
      sessionAtVerifyEntryRef.current = !!session;
      setCode(["", "", "", "", "", ""]);
      setCodeStage("idle");
      setStep("verify");
    } catch (e) {
      setError(errMsg(e, "Couldn't send your code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function sendMagic() {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await signInWithMagicLink(email.trim());
      setStep("sent");
    } catch (e) {
      setError(errMsg(e, "Couldn't send the link. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function signInPw() {
    if (password.length < 1 || loading) return;
    setError("");
    setLoading(true);
    try {
      await signInWithPassword(email.trim(), password);
      setLoading(false);
      goDone("You're in", "Taking you to your workspace…");
    } catch (e) {
      setError(errMsg(e, "Sign in failed. Check your details and try again."));
      setLoading(false);
    }
  }

  async function submitCode(joined: string) {
    setError("");
    setCodeStage("confirming");
    try {
      const verifiedUser = await verifySignupCode(email.trim(), joined);
      advanceRef.current(verifiedUser.id);
    } catch (e) {
      setCodeStage("idle");
      setError(errMsg(e, "That code didn't work. Check it and try again."));
      setCode(["", "", "", "", "", ""]);
      codeInputsRef.current[0]?.focus();
    }
  }

  function handleCodeChange(i: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setCode((prev) => {
        const n = prev.slice();
        n[i] = "";
        return n;
      });
      return;
    }
    setCode((prev) => {
      const n = prev.slice();
      for (let k = 0; k < digits.length && i + k < 6; k++) n[i + k] = digits[k];
      return n;
    });
    const nextIdx = Math.min(i + digits.length, 5);
    codeInputsRef.current[nextIdx]?.focus();
  }

  function handleCodeKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      e.preventDefault();
      codeInputsRef.current[i - 1]?.focus();
    }
  }

  async function continueNewPw() {
    if (!chk.valid || loading) return;
    setError("");
    setLoading(true);
    try {
      await applyPassword(password);
      setLoading(false);
      setStep("welcome");
    } catch (e) {
      setError(errMsg(e, "Couldn't save your password. Please try again."));
      setLoading(false);
    }
  }

  const profileValid = () => !!(firstName.trim() && lastName.trim() && brokerage.trim());
  const sourceComplete = () => {
    const cat = SOURCES.find((s) => s.id === sourceCat);
    if (!cat) return false;
    return cat.subs.length === 0 || !!sourceSub;
  };

  async function finish() {
    if (!(profileValid() && persona && sourceComplete()) || loading) return;
    setError("");
    setLoading(true);
    try {
      await completeOnboarding({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        brokerage: brokerage.trim(),
        persona,
        signupSource: sourceCat as string,
        signupSourceDetail: sourceSub,
      });
      setLoading(false);
      goDone(`You're all set, ${firstName.trim() || "welcome"}`, "Setting up your workspace…");
    } catch (e) {
      setError(errMsg(e, "Couldn't finish setup. Please try again."));
      setLoading(false);
    }
  }

  // Clear the signup onboarding fields so switching flow / email never carries a
  // stale name, brokerage, persona, or source into a different account.
  function resetOnboardingFields() {
    setFirstName("");
    setLastName("");
    setBrokerage("");
    setPersona(null);
    setSourceCat(null);
    setSourceSub(null);
  }
  function changeEmail() {
    advancedRef.current = false;
    setStep("email");
    setPasswordValue("");
    setLoading(false);
    setCode(["", "", "", "", "", ""]);
    setCodeStage("idle");
    resetOnboardingFields();
  }
  function useDifferent() {
    changeEmail();
    setEmail("");
  }
  function toSignup() {
    advancedRef.current = false;
    setFlow("signup");
    setStep("email");
    setPasswordValue("");
    setLoading(false);
    setCode(["", "", "", "", "", ""]);
    setCodeStage("idle");
    resetOnboardingFields();
  }
  function toSignin() {
    advancedRef.current = false;
    setFlow("signin");
    setStep("email");
    setPasswordValue("");
    setLoading(false);
    setCode(["", "", "", "", "", ""]);
    setCodeStage("idle");
    resetOnboardingFields();
  }

  // Tab-trap within the card.
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

  // ── Reusable fragments ───────────────────────────────────────────────────
  const emailPill = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "11px 13px",
        background: "var(--le-bg-elev)",
        border: "1px solid var(--le-border)",
        borderRadius: "var(--le-r-md)",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: "50%",
            background: "var(--le-tile-sky-bg)",
            color: "var(--le-tile-sky-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MailIcon />
        </span>
        <span style={{ fontSize: 13.5, color: "var(--le-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email}
        </span>
      </div>
      <button type="button" onClick={changeEmail} style={linkBtnStyle(12.5)}>
        Change
      </button>
    </div>
  );

  function renderStep() {
    switch (step) {
      case "email":
        return (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={headingStyle}>{isSignup ? "Create your account" : "Sign in"}</div>
              <div style={subStyle}>{isSignup ? "We'll just need your email to begin." : "Enter your email to continue."}</div>
            </div>

            <SocialAuthButtons onGoogleSuccess={handleGoogleSuccess} onGoogleError={handleGoogleError} disabled={loading} />

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--le-border-strong)" }} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--le-text-faint)", letterSpacing: "0.02em" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "var(--le-border-strong)" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              <label htmlFor="le-login-email" style={fieldLabelStyle}>
                Email
              </label>
              <input
                id="le-login-email"
                ref={emailRef}
                className="le-login-input"
                type="email"
                autoComplete="email"
                placeholder="you@brokerage.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") continueEmail();
                }}
                data-autofocus-deferred="true"
                style={fieldInputStyle}
              />
            </div>

            <PrimaryButton onClick={continueEmail} disabled={!emailOk(email) || loading} loading={loading}>
              Continue
              <ArrowIcon />
            </PrimaryButton>

            <div
              style={{
                textAlign: "center",
                marginTop: 20,
                paddingTop: 18,
                borderTop: "1px solid var(--le-border)",
                fontSize: 13.5,
                color: "var(--le-text-muted)",
              }}
            >
              {isSignup ? (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={toSignin} style={linkBtnStyle(13.5)}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New to Listing Elevate?{" "}
                  <button type="button" onClick={toSignup} style={linkBtnStyle(13.5)}>
                    Create an account
                  </button>
                </>
              )}
            </div>
          </div>
        );

      case "choose":
        return (
          <div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...headingStyle, fontSize: 21, letterSpacing: "-0.025em" }}>How would you like to sign in?</div>
            </div>
            {emailPill}
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "24px 0" }}>
                <span
                  className="le-login-spin"
                  style={{ width: 26, height: 26, border: "2.5px solid var(--le-border-strong)", borderTopColor: BLUE, borderRadius: "50%", display: "inline-block" }}
                />
                <div style={{ fontSize: 14, color: "var(--le-text-muted)" }}>Sending your magic link…</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button type="button" onClick={() => setStep("password")} className="le-login-method" style={methodCardStyle}>
                  <span style={{ ...methodIconStyle, background: "var(--le-tile-sky-bg)", color: "var(--le-tile-sky-ink)" }}>
                    <LockIcon />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={methodTitleStyle}>Use my password</span>
                    <span style={methodSubStyle}>Sign in with your password</span>
                  </span>
                  <span style={{ color: "var(--le-text-faint)", display: "flex" }}>
                    <ChevronIcon />
                  </span>
                </button>
                <button type="button" onClick={sendMagic} className="le-login-method" style={methodCardStyle}>
                  <span style={{ ...methodIconStyle, background: "var(--le-tile-lavender-bg)", color: "var(--le-tile-lavender-ink)" }}>
                    <SparkleIcon />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={methodTitleStyle}>Email me a magic link</span>
                    <span style={methodSubStyle}>One-time link, no password</span>
                  </span>
                  <span style={{ color: "var(--le-text-faint)", display: "flex" }}>
                    <ChevronIcon />
                  </span>
                </button>
              </div>
            )}
          </div>
        );

      case "password":
        return (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...headingStyle, fontSize: 21, letterSpacing: "-0.025em" }}>Enter your password</div>
            </div>
            {emailPill}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label htmlFor="le-login-pw" style={fieldLabelStyle}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={sendMagic}
                  style={{ border: "none", background: "none", padding: 0, fontFamily: "var(--le-font-sans)", fontWeight: 500, fontSize: 12.5, color: "var(--le-text-muted)", cursor: "pointer" }}
                >
                  Forgot?
                </button>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  id="le-login-pw"
                  ref={pwRef}
                  className="le-login-input"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") signInPw();
                  }}
                  style={{ ...fieldInputStyle, paddingRight: 56 }}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} style={pwToggleStyle}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <PrimaryButton onClick={signInPw} disabled={password.length < 1 || loading} loading={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </PrimaryButton>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" onClick={sendMagic} style={{ ...linkBtnStyle(13.5), fontWeight: 500 }}>
                Email me a one-time link instead
              </button>
            </div>
          </div>
        );

      case "sent":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 13, padding: "8px 0 10px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--le-tile-sky-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--le-tile-sky-ink)" }}>
              <MailIcon size={26} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em" }}>Check your inbox</div>
            <div style={{ fontSize: 14, color: "var(--le-text-muted)", lineHeight: 1.5, maxWidth: 290 }}>
              We sent a one-time sign-in link to <b style={{ color: "var(--le-text)", fontWeight: 600 }}>{email}</b>. It expires in 10 minutes.
            </div>
            <button
              type="button"
              onClick={useDifferent}
              style={{
                marginTop: 4,
                border: "1px solid var(--le-border-strong)",
                background: "#fff",
                borderRadius: "var(--le-r-pill)",
                padding: "9px 17px",
                fontFamily: "var(--le-font-sans)",
                fontWeight: 600,
                fontSize: 13,
                color: "var(--le-text)",
                cursor: "pointer",
              }}
            >
              Use a different email
            </button>
          </div>
        );

      case "verify":
        return (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={headingStyle}>Check your email</div>
              <div style={subStyle}>
                We sent a 6-digit code and a secure sign-in link to <b style={{ color: "var(--le-text)", fontWeight: 600 }}>{email}</b>.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    codeInputsRef.current[i] = el;
                  }}
                  className={`le-login-input${d ? " le-login-fade" : ""}`}
                  value={d}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={i === 0 ? 6 : 1}
                  aria-label={`Verification code digit ${i + 1}`}
                  style={{
                    width: 46,
                    height: 56,
                    flex: "none",
                    textAlign: "center",
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--le-text)",
                    borderRadius: 10,
                    boxSizing: "border-box",
                    background: d ? "var(--le-accent-soft)" : "var(--le-bg-elev)",
                    border: d ? `1.5px solid ${BLUE}` : "1.5px solid var(--le-border)",
                    fontFamily: "var(--le-font-sans)",
                    outline: "none",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--le-text-muted)", marginBottom: 20 }}>
              {codeStage === "verified" ? (
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--le-success-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckIcon stroke="var(--le-success)" />
                </span>
              ) : (
                <span
                  className="le-login-spin"
                  style={{ width: 13, height: 13, border: "2px solid var(--le-border-strong)", borderTopColor: BLUE, borderRadius: "50%", display: "inline-block" }}
                />
              )}
              {codeStage === "verified" ? "Verified" : codeStage === "confirming" ? "Confirming…" : "Waiting for code…"}
            </div>
            <div style={{ textAlign: "center" }}>
              <button type="button" onClick={changeEmail} style={{ ...linkBtnStyle(13), fontWeight: 500 }}>
                Wrong email? Go back
              </button>
            </div>
          </div>
        );

      case "newpw":
        return (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={headingStyle}>Create a password</div>
              <div style={subStyle}>You'll use this to sign in next time.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              <label htmlFor="le-login-npw" style={fieldLabelStyle}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="le-login-npw"
                  ref={newPwRef}
                  className="le-login-input"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") continueNewPw();
                  }}
                  style={{ ...fieldInputStyle, paddingRight: 56 }}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} style={pwToggleStyle}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ height: 6, borderRadius: 3, background: "var(--le-bg-elev)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, transition: "width .25s ease, background .25s ease", width: `${chk.pct}%`, background: chk.color }} />
              </div>
              {chk.label && <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, color: chk.color }}>{chk.label}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 22 }}>
              {chk.criteria.map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--le-text-muted)" }}>
                  {c.ok ? (
                    <span style={{ width: 16, height: 16, flex: "none", borderRadius: "50%", background: "var(--le-success-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CheckIcon size={9} stroke="var(--le-success)" sw={3.2} />
                    </span>
                  ) : (
                    <span style={{ width: 16, height: 16, flex: "none", borderRadius: "50%", background: "var(--le-bg-elev)", border: "1px solid var(--le-border-strong)" }} />
                  )}
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
            <PrimaryButton onClick={continueNewPw} disabled={!chk.valid || loading} loading={loading}>
              Continue
              <ArrowIcon />
            </PrimaryButton>
          </div>
        );

      case "welcome":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "20px 6px 24px" }}>
            <div className="le-login-bob" style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--le-accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckIcon size={30} stroke={BLUE} sw={2.2} />
            </div>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.028em" }}>Welcome to Listing Elevate</div>
            <div style={{ fontSize: 14, color: "var(--le-text-muted)", lineHeight: 1.5, display: "inline-flex", alignItems: "center", gap: 9 }}>
              <InkSpinner />
              Setting up your workspace…
            </div>
          </div>
        );

      case "profile":
        return (
          <div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...headingStyle, fontSize: 22, letterSpacing: "-0.025em" }}>Tell us about you</div>
              <div style={subStyle}>A few details to personalize your workspace.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              <label htmlFor="le-login-fname" style={fieldLabelStyle}>
                First name
              </label>
              <input
                id="le-login-fname"
                ref={firstNameRef}
                className="le-login-input"
                type="text"
                autoComplete="given-name"
                placeholder="Jordan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={fieldInputStyle}
              />
            </div>
            {firstName.trim().length > 0 && (
              <div className="le-login-reveal" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                <label htmlFor="le-login-lname" style={fieldLabelStyle}>
                  Last name
                </label>
                <input
                  id="le-login-lname"
                  className="le-login-input"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Rivera"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  style={fieldInputStyle}
                />
              </div>
            )}
            {lastName.trim().length > 0 && (
              <div className="le-login-reveal" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                <label htmlFor="le-login-brokerage" style={fieldLabelStyle}>
                  Brokerage
                </label>
                <input
                  id="le-login-brokerage"
                  className="le-login-input"
                  type="text"
                  autoComplete="organization"
                  placeholder="Compass, Coldwell Banker…"
                  value={brokerage}
                  onChange={(e) => setBrokerage(e.target.value)}
                  style={fieldInputStyle}
                />
              </div>
            )}
            {brokerage.trim().length > 0 && (
              <div className="le-login-reveal" style={{ marginTop: 6 }}>
                <PrimaryButton onClick={() => setStep("role")} disabled={!profileValid()}>
                  Continue
                  <ArrowIcon />
                </PrimaryButton>
              </div>
            )}
          </div>
        );

      case "role":
        return (
          <div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...headingStyle, fontSize: 22, letterSpacing: "-0.025em" }}>What best describes you?</div>
              <div style={subStyle}>This helps us tailor your workspace.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
              {PERSONAS.map((r) => {
                const sel = persona === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setPersona(r.id)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      textAlign: "left",
                      padding: "15px 14px",
                      borderRadius: "var(--le-r-lg)",
                      cursor: "pointer",
                      transition: "border-color .15s, box-shadow .15s, background .15s",
                      border: `1.5px solid ${sel ? BLUE : "var(--le-border-strong)"}`,
                      background: sel ? "var(--le-accent-soft)" : "#fff",
                      boxShadow: sel ? "0 2px 10px rgba(var(--le-brand-blue-rgb), .16)" : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: sel ? BLUE : "var(--le-bg-elev)",
                        color: sel ? "#fff" : "var(--le-text-muted)",
                      }}
                    >
                      <PathIcon d={r.icon} />
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--le-text)" }}>{r.label}</span>
                    <span style={{ fontSize: 11.5, color: "var(--le-text-muted)", lineHeight: 1.3 }}>{r.sub}</span>
                  </button>
                );
              })}
            </div>
            <PrimaryButton onClick={() => setStep("source")} disabled={!persona}>
              Continue
              <ArrowIcon />
            </PrimaryButton>
          </div>
        );

      case "source":
        return (
          <div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...headingStyle, fontSize: 22, letterSpacing: "-0.025em" }}>How did you hear about us?</div>
              <div style={subStyle}>Last step — promise.</div>
            </div>
            <div role="radiogroup" aria-label="How did you hear about us?" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {SOURCES.map((s) => {
                const sel = sourceCat === s.id;
                const expanded = sel && s.subs.length > 0;
                return (
                  <div key={s.id} style={{ display: "flex", flexDirection: "column" }}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => {
                        setSourceCat(s.id);
                        setSourceSub(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 13px",
                        borderRadius: "var(--le-r-lg)",
                        cursor: "pointer",
                        transition: "border-color .2s, background .2s",
                        border: `1.5px solid ${sel ? BLUE : "var(--le-border-strong)"}`,
                        background: sel ? "var(--le-accent-soft)" : "#fff",
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          flex: "none",
                          boxSizing: "border-box",
                          transition: "border .2s",
                          background: "#fff",
                          border: sel ? `5.5px solid ${BLUE}` : "1.5px solid var(--le-border-strong)",
                        }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--le-text)" }}>{s.label}</span>
                    </button>
                    {expanded && (
                      <div className="le-login-reveal" style={{ padding: "10px 4px 4px 33px" }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--le-text-muted)", marginBottom: 7 }}>Which one?</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {s.subs.map((name) => {
                            const csel = sourceSub === name;
                            return (
                              <button
                                key={name}
                                type="button"
                                aria-pressed={csel}
                                onClick={() => setSourceSub(name)}
                                style={{
                                  padding: "7px 13px",
                                  borderRadius: "var(--le-r-pill)",
                                  cursor: "pointer",
                                  fontFamily: "var(--le-font-sans)",
                                  fontWeight: 500,
                                  fontSize: 13,
                                  transition: "border-color .18s, background .18s, color .18s",
                                  border: `1.5px solid ${csel ? BLUE : "var(--le-border-strong)"}`,
                                  background: csel ? BLUE : "#fff",
                                  color: csel ? "#fff" : "var(--le-text)",
                                }}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <PrimaryButton onClick={finish} disabled={!sourceComplete() || loading} loading={loading}>
              Finish setup
            </PrimaryButton>
          </div>
        );

      case "done":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "20px 6px 24px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--le-success-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckIcon size={30} stroke="var(--le-success)" sw={2.2} />
            </div>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.028em" }}>{done.title}</div>
            <div style={{ fontSize: 14, color: "var(--le-text-muted)", lineHeight: 1.5, display: "inline-flex", alignItems: "center", gap: 9 }}>
              <InkSpinner />
              {done.sub}
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="le-login-overlay"
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            overflowY: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 16px",
            fontFamily: "var(--le-font-sans)",
            color: "var(--le-text)",
            isolation: "isolate",
            background: "radial-gradient(120% 120% at 50% 40%, #f2f4f9 0%, #e9ecf3 60%, #e2e5ee 100%)",
          }}
        >
          {/* Backdrop parallax orbs (wrapper is parallaxed; inner drifts) */}
          <div
            data-px="0.6"
            style={{ position: "absolute", left: "-12%", top: "-16%", width: 560, height: 560, pointerEvents: "none", transition: "transform .35s cubic-bezier(.2,.7,.2,1)", willChange: "transform" }}
          >
            <div
              className="le-login-bgorb1"
              style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 45% 45%, rgba(var(--le-brand-blue-rgb),.14), rgba(var(--le-brand-blue-rgb),0) 66%)", filter: "blur(30px)" }}
            />
          </div>
          <div
            data-px="1.2"
            style={{ position: "absolute", right: "-14%", bottom: "-18%", width: 600, height: 600, pointerEvents: "none", transition: "transform .35s cubic-bezier(.2,.7,.2,1)", willChange: "transform" }}
          >
            <div
              className="le-login-bgorb2"
              style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 50% 45%, rgba(129,84,232,.13), rgba(129,84,232,0) 66%)", filter: "blur(34px)" }}
            />
          </div>

          {/* Dim layer — click to close */}
          <div aria-hidden="true" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(16,20,34,.16)" }} />

          {/* Tilt wrapper */}
          <div
            data-tilt="0.7"
            style={{
              position: "relative",
              transition: "transform .25s cubic-bezier(.2,.7,.2,1)",
              willChange: "transform",
              transformStyle: "preserve-3d",
              width: "min(448px, calc(100vw - 32px))",
            }}
          >
            <motion.div
              ref={dialogRef}
              className="le-login-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="le-login-heading"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleDialogKeyDown}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: reduce ? 0 : ENTRY_MS / 1000, ease: EASE }}
              style={{
                position: "relative",
                width: "100%",
                background: "#fff",
                borderRadius: "var(--le-r-xl)",
                boxShadow: "0 36px 84px -22px rgba(10,14,30,.4), 0 4px 14px rgba(10,14,30,.12)",
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div className="le-login-header" style={{ position: "relative", height: 132, background: "linear-gradient(165deg, #0b1730 0%, #0f2255 48%, #1d3f8f 100%)", overflow: "hidden" }}>
                <div className="le-login-headorb-w le-login-headorb-w1" style={{ position: "absolute", left: "-16%", top: "-46%", width: 320, height: 320 }}>
                  <div className="le-login-headorb-i1" style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 45% 45%, rgba(var(--le-brand-blue-rgb),.5), rgba(var(--le-brand-blue-rgb),0) 66%)", filter: "blur(20px)" }} />
                </div>
                <div className="le-login-headorb-w le-login-headorb-w2" style={{ position: "absolute", left: "32%", top: "-62%", width: 260, height: 260 }}>
                  <div className="le-login-headorb-i2" style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 50% 50%, rgba(80,150,255,.4), rgba(80,150,255,0) 66%)", filter: "blur(20px)" }} />
                </div>
                <div className="le-login-headorb-w le-login-headorb-w3" style={{ position: "absolute", right: "-14%", bottom: "-58%", width: 300, height: 300 }}>
                  <div className="le-login-headorb-i3" style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 50% 45%, rgba(20,40,90,.7), rgba(20,40,90,0) 64%)", filter: "blur(22px)" }} />
                </div>
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.22, mixBlendMode: "overlay", backgroundImage: NOISE_BG, backgroundSize: "140px 140px" }} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 44, background: "linear-gradient(to top, rgba(255,255,255,.10), rgba(255,255,255,0))" }} />
                <div style={{ position: "absolute", left: 28, bottom: 18 }} id="le-login-heading">
                  <LELogoMark size={40} variant="light" />
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="le-login-close"
                  style={{ position: "absolute", right: 0, top: 0, width: 64, height: 64, border: "none", background: "none", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 14, boxSizing: "border-box", cursor: "pointer", color: "rgba(255,255,255,.85)" }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,.14)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <XIcon />
                  </span>
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: "30px 36px" }}>
                {error && (
                  <div role="alert" style={{ border: "1px solid var(--le-danger)", background: "var(--le-danger-soft)", padding: 12, borderRadius: "var(--le-r-md)", marginBottom: 16 }}>
                    <p style={{ margin: 0, fontSize: 12.5, color: "var(--le-danger)", fontFamily: "var(--le-font-sans)" }}>{error}</p>
                  </div>
                )}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.985 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.99 }}
                    transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                  >
                    {renderStep()}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Static style constants used across steps ────────────────────────────────
const methodCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 13,
  width: "100%",
  textAlign: "left",
  padding: "13px 14px",
  background: "#fff",
  border: "1px solid var(--le-border-strong)",
  borderRadius: "var(--le-r-lg)",
  cursor: "pointer",
};
const methodIconStyle: CSSProperties = {
  width: 36,
  height: 36,
  flex: "none",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const methodTitleStyle: CSSProperties = { display: "block", fontSize: 14, fontWeight: 600, color: "var(--le-text)" };
const methodSubStyle: CSSProperties = { display: "block", fontSize: 12.5, color: "var(--le-text-muted)", marginTop: 1 };
const pwToggleStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  top: "50%",
  transform: "translateY(-50%)",
  border: "none",
  background: "none",
  padding: "2px 4px",
  fontFamily: "var(--le-font-sans)",
  fontWeight: 600,
  fontSize: 12,
  color: "var(--le-text-muted)",
  cursor: "pointer",
};
