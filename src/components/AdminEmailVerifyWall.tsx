import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Shared input style for the admin email-code (6-digit OTP) verification wall.
const wallInputCls =
  "w-full text-center text-[20px] tracking-[0.3em] py-[11px] px-[14px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] outline-none font-[inherit] box-border tabular-nums";

function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return local[0] + "•••@" + domain;
  return (
    local[0] +
    "•".repeat(local.length - 2) +
    local[local.length - 1] +
    "@" +
    domain
  );
}

export function AdminEmailVerifyWall() {
  const { sendAdminEmailCode, verifyAdminEmailCode, signOut, user } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [cooldown, setCooldown] = useState(60);

  // Guard against React StrictMode double-mount calling sendAdminEmailCode twice
  const sentRef = useRef(false);

  async function doSend() {
    setError("");
    setSending(true);
    setSendStatus("sending");
    try {
      await sendAdminEmailCode();
      setSendStatus("sent");
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
      setSendStatus("idle");
      setCooldown(0);
    } finally {
      setSending(false);
    }
  }

  // Auto-send exactly once on mount
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    void doSend();
  }, []);

  // Cooldown countdown — each tick restarts the effect via state change
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError("");
    setSubmitting(true);
    try {
      await verifyAdminEmailCode(code);
      // On success adminVerified flips true upstream — wall unmounts automatically
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(
        /expired|invalid|incorrect|token/i.test(msg)
          ? "That code is incorrect or expired — request a new one."
          : msg
      );
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const maskedEmail = user?.email ? maskEmail(user.email) : "your email";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="le-card w-full max-w-[380px] p-8">

        {/* Shield icon — uses Tailwind arbitrary CSS-var values */}
        <div className="w-11 h-11 grid place-items-center rounded-[var(--le-r-lg)] bg-[var(--accent-soft)] text-[var(--accent)] mb-5">
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

        <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-[var(--ink)] mb-1.5">
          Verify it's you
        </h2>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5] mb-6">
          For your security, enter the 6-digit code we emailed to{" "}
          <span className="font-medium text-[var(--ink)]">{maskedEmail}</span>.
        </p>

        {sendStatus === "sending" && (
          <p className="text-[12px] text-[var(--muted)] mb-4">Sending code…</p>
        )}
        {sendStatus === "sent" && (
          <p className="text-[12px] text-[var(--muted)] mb-4">Code sent.</p>
        )}

        <form onSubmit={handleVerify} className="flex flex-col gap-3.5">
          <div>
            <label
              htmlFor="admin-email-code"
              className="block text-[12px] font-medium text-[var(--muted)] mb-1.5"
            >
              6-digit code
            </label>
            <input
              id="admin-email-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={wallInputCls}
            />
          </div>

          {error && (
            <p role="alert" className="text-[12px] leading-[1.5] text-[var(--bad)] m-0">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="le-btn-dark text-[13px] py-2.5 px-5 disabled:opacity-60"
            disabled={code.length !== 6 || submitting}
          >
            {submitting ? "Verifying..." : "Verify"}
          </button>

          <button
            type="button"
            className="le-btn-ghost text-[12px] py-2 px-4 disabled:opacity-50"
            disabled={cooldown > 0 || sending}
            onClick={() => void doSend()}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </form>

        <p className="text-[12px] text-[var(--muted)] mt-5 leading-[1.5]">
          Didn't get a code? Open the link in that same email to continue, or{" "}
          <button
            type="button"
            className="le-btn-ghost text-[12px] py-0.5 px-1"
            onClick={() => void handleSignOut()}
          >
            sign out
          </button>
          .
        </p>
      </div>
    </div>
  );
}
