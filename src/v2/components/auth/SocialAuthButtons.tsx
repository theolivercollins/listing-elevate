import { useEffect, useRef, useState } from "react";
import { initGoogleIdentity } from "@/lib/googleIdentity";

export interface SocialAuthButtonsProps {
  /**
   * Called once a Google sign-in completes — the existing
   * `onAuthStateChange` listener has already picked up the new session by
   * this point, so the caller just reacts (e.g. closes the login dialog).
   */
  onGoogleSuccess: () => void;
  /**
   * Surfaced when Google Identity Services fails to load, fails to init, or
   * the ID-token exchange itself errors.
   */
  onGoogleError: (message: string) => void;
  disabled?: boolean;
}

type GsiStatus = "loading" | "ready" | "unavailable";

/**
 * SocialAuthButtons — renders Google's own "Sign in with Google" button via
 * Google Identity Services (GSI): the ID-token flow required because the
 * Supabase Google provider here is configured with a Client ID only (no
 * client secret — see `@/lib/googleIdentity`, which owns nonce generation,
 * `initialize`, and the `signInWithIdToken` exchange). This component's job
 * is just to load GSI once, render the button into a container, and forward
 * the two outcomes (success / error) up to the caller.
 *
 * The button itself is Google-rendered (an embedded iframe) — its
 * appearance is controlled only via GSI's theme/size/shape options, not
 * arbitrary CSS, per Google's branding guidelines. The `unavailable` state
 * (script blocked, offline, ad blocker) degrades gracefully: the container
 * is hidden and a plain-text fallback appears — magic-link / password
 * sign-in below stay fully usable either way.
 */
export function SocialAuthButtons({
  onGoogleSuccess,
  onGoogleError,
  disabled,
}: SocialAuthButtonsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<GsiStatus>("loading");

  // Latest callbacks live in refs so the mount-once init effect below never
  // closes over a stale prop, without needing to re-run GSI init on every
  // parent re-render (e.g. `disabled` flipping while a magic link sends).
  const onSuccessRef = useRef(onGoogleSuccess);
  const onErrorRef = useRef(onGoogleError);
  useEffect(() => {
    onSuccessRef.current = onGoogleSuccess;
  }, [onGoogleSuccess]);
  useEffect(() => {
    onErrorRef.current = onGoogleError;
  }, [onGoogleError]);

  useEffect(() => {
    let cancelled = false;

    initGoogleIdentity({
      onSuccess: () => {
        if (!cancelled) onSuccessRef.current();
      },
      onError: (message) => {
        if (!cancelled) onErrorRef.current(message);
      },
    })
      .then(() => {
        if (cancelled || !containerRef.current) return;
        google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          logo_alignment: "left",
          // GSI's renderButton wants a pixel width, not "100%" — clamp to
          // the container's own measured width so it fills the card without
          // overflowing on very narrow viewports.
          width: Math.min(360, Math.max(200, containerRef.current.offsetWidth || 360)),
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
      // Best-effort teardown of any active prompt. Guarded: the global may
      // never have loaded (script blocked/offline), in which case there is
      // nothing to cancel.
      if (typeof google !== "undefined") google.accounts?.id?.cancel();
    };
    // Intentionally mount-once: initGoogleIdentity/renderButton/cancel are
    // stable module functions, and the latest onGoogleSuccess/onGoogleError
    // are always read via the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        ref={containerRef}
        data-testid="google-signin-button"
        aria-busy={status === "loading"}
        style={{
          display: status === "unavailable" ? "none" : "flex",
          justifyContent: "center",
          minHeight: 44,
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? "none" : "auto",
        }}
      />
      {status === "unavailable" && (
        <p
          className="le-eyebrow"
          style={{
            textTransform: "none",
            textAlign: "center",
            color: "var(--le-text-faint)",
            margin: 0,
          }}
        >
          Google sign-in unavailable — use email below.
        </p>
      )}
    </div>
  );
}
