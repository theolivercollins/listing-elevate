/**
 * Google Identity Services (GSI) — "Sign in with Google" ID-token flow.
 *
 * The Supabase Google provider here is configured with a Client ID ONLY (no
 * client secret), which rules out the OAuth-redirect flow
 * (`supabase.auth.signInWithOAuth`) — that flow needs a secret to exchange
 * the authorization code for tokens server-side. GSI instead mints a signed
 * ID token entirely client-side (via Google's own button/One Tap UI);
 * `supabase.auth.signInWithIdToken` verifies it directly against Google's
 * public keys, so no secret is required.
 *
 * Reuses the generic `loadScript` memoized loader + GSI script URL from
 * `@/lib/google-picker` (the same `accounts.google.com/gsi/client` bundle
 * already used there for the Drive OAuth token client, which also exposes
 * this Sign-In surface as `google.accounts.id`) so the script tag is only
 * ever injected once per tab regardless of which feature needs it first.
 *
 * See: https://supabase.com/docs/guides/auth/social-login/auth-google#signing-in-with-id-token
 */
import { loadScript } from "./google-picker";
import { supabase } from "./supabase";

const GIS_URL = "https://accounts.google.com/gsi/client";

/**
 * Public Google OAuth Client ID for the Sign-In (GSI button / One Tap) flow.
 * Client IDs are NOT secrets — they ship in every browser's page source for
 * any site using Google Sign-In — so a hardcoded fallback is safe here.
 */
export const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
  "42664464071-du05hidg69vck0g0g6lv7vk65d5oe17o.apps.googleusercontent.com";

/**
 * Generates a cryptographically-random nonce and its SHA-256 hex digest.
 *
 * Google's `initialize({ nonce })` must receive the HASHED value (the raw
 * value is never sent to Google); Supabase's `signInWithIdToken({ nonce })`
 * must receive the RAW value (Supabase hashes it itself and compares
 * against the `nonce` claim baked into the ID token by Google). Sending the
 * same value to both would defeat the point of hashing.
 */
export async function generateNonce(): Promise<{ raw: string; hashed: string }> {
  const rawBytes = new Uint8Array(32);
  crypto.getRandomValues(rawBytes);
  const raw = Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

  return { raw, hashed };
}

export interface InitGoogleIdentityOptions {
  /**
   * Called once `signInWithIdToken` resolves without error. The existing
   * `onAuthStateChange` listener in `AuthProvider` has already picked up the
   * new session by this point — callers just need to react (e.g. close a
   * login modal).
   */
  onSuccess: () => void;
  /**
   * Called with a user-facing message on ANY failure: the GSI script
   * failing to load, `initialize` throwing, or the ID-token exchange itself
   * erroring (bad/expired token, nonce mismatch, provider not configured).
   */
  onError: (message: string) => void;
}

/**
 * Loads GSI (if not already loaded), generates a nonce pair, and calls
 * `google.accounts.id.initialize` with the HASHED nonce. The credential
 * callback exchanges the resulting ID token for a Supabase session via
 * `signInWithIdToken`, passing the RAW nonce.
 *
 * Resolves once `initialize` has been called — the button itself still
 * needs a real DOM node, so callers render it separately via
 * `google.accounts.id.renderButton(el, options)` once this resolves.
 *
 * Rejects if the script fails to load (offline, blocked by an ad blocker,
 * etc.) — callers should degrade to email/password sign-in on rejection.
 */
export async function initGoogleIdentity({
  onSuccess,
  onError,
}: InitGoogleIdentityOptions): Promise<void> {
  await loadScript(GIS_URL);
  const { raw, hashed } = await generateNonce();

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: hashed,
    // Never silently sign a returning visitor back in without a click —
    // consistent with every other provider in this dialog.
    auto_select: false,
    // FedCM is the browser-mediated path Google recommends for new
    // integrations (third-party cookies, which the classic prompt relied
    // on, are being phased out across browsers).
    use_fedcm_for_prompt: true,
    callback: async ({ credential }) => {
      try {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: credential,
          nonce: raw,
        });
        if (error) throw error;
        onSuccess();
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : "Google sign-in failed. Use email below for now.",
        );
      }
    },
  });
}
