import { createContext, useContext, useEffect, useMemo, useReducer, useState, ReactNode } from "react";
import { supabase, AUTH_CALLBACK_URL } from "./supabase";
import { migrateLocalPresets } from "./presets";
import { authedFetch } from "./api";
import type { User, Session, UserIdentity } from "@supabase/supabase-js";

/** Roles an admin may preview as, in the Operator Studio role switcher. */
export const IMPERSONATABLE_ROLES: { value: "admin" | "user"; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "Agent" },
];

// sessionStorage keys for the active impersonation session. BOTH are required
// to rehydrate — a half-present pair is treated as not-impersonating.
const IMPERSONATE_ROLE_KEY = "le_impersonate_role";
const IMPERSONATE_TOKEN_KEY = "le_impersonate_token";

interface ImpersonationState {
  role: "admin" | "user";
  token: string;
}

/** Reads a valid impersonation pair from sessionStorage, or null. */
function readImpersonation(): ImpersonationState | null {
  if (typeof sessionStorage === "undefined") return null;
  const role = sessionStorage.getItem(IMPERSONATE_ROLE_KEY);
  const token = sessionStorage.getItem(IMPERSONATE_TOKEN_KEY);
  if (!token || (role !== "admin" && role !== "user")) return null;
  return { role, token };
}

function clearImpersonationStorage(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(IMPERSONATE_ROLE_KEY);
  sessionStorage.removeItem(IMPERSONATE_TOKEN_KEY);
}

export interface UserProfile {
  id: string;
  user_id: string;
  role: "admin" | "user";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  brokerage: string | null;
  logo_url: string | null;
  /** Personal profile photo, uploaded to the `user-logos` Storage bucket under `${user_id}/avatar.<ext>`. */
  avatar_url: string | null;
  colors: { primary: string; secondary: string };
  presets: unknown[];
  created_at: string;
  updated_at: string;
  voice_clone_status?: "none" | "requested" | "enrolling" | "ready" | "failed" | null;
  elevenlabs_voice_id?: string | null;
  /** Persona self-selected during onboarding (migration 105). Nullable / additive. */
  persona?: "agent" | "team_leader" | "broker" | "marketing" | null;
  /** Acquisition source category, e.g. "search" (migration 105). */
  signup_source?: string | null;
  /** Acquisition source sub-choice, e.g. "Google" (migration 105). */
  signup_source_detail?: string | null;
}

/** Onboarding details captured by the signup flow's profile/role/source steps. */
export interface OnboardingDetails {
  firstName: string;
  lastName: string;
  brokerage: string;
  persona: "agent" | "team_leader" | "broker" | "marketing";
  signupSource: string;
  signupSourceDetail: string | null;
}

// ─── Admin-verified session marker ───────────────────────────────────────────
// Stored in sessionStorage (cleared when the tab closes) so the gate re-runs
// on every new browser session. sessionStorage is keyed by user id to survive
// multi-account flows.

const ADMIN_VERIFIED_PREFIX = "le_admin_verified:";

function markAdminVerified(userId: string) {
  try { sessionStorage.setItem(ADMIN_VERIFIED_PREFIX + userId, "1"); } catch { /* sessionStorage may throw in some privacy modes */ }
}

function clearAdminVerified(userId: string) {
  try { sessionStorage.removeItem(ADMIN_VERIFIED_PREFIX + userId); } catch { /* ignore */ }
}

function clearAllAdminVerified() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(ADMIN_VERIFIED_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

function isAdminVerified(userId: string): boolean {
  try { return sessionStorage.getItem(ADMIN_VERIFIED_PREFIX + userId) === "1"; } catch { return false; }
}

// Email-possession proof comes from the Supabase-signed JWT's `amr`
// (Authentication Methods References) claim — an array of {method, timestamp}
// recording HOW the session authenticated. It is signed by Supabase and cannot
// be forged via URL params, so it is not bypassable the way a URL snapshot is.
function decodeJwtPayload(token: string): any | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bin = atob(b64);
    const json = decodeURIComponent(Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    return JSON.parse(json);
  } catch { return null; }
}

// True when the session's MOST RECENT auth method proves email possession
// (magic link / email OTP) — never a password sign-in.
function sessionProvesEmailPossession(session: Session | null): boolean {
  const payload = session?.access_token ? decodeJwtPayload(session.access_token) : null;
  const amr = payload?.amr;
  if (!Array.isArray(amr) || amr.length === 0) return false;
  const dated = amr.filter((e: any) => typeof e?.timestamp === "number");
  if (dated.length === 0) return false;
  const latest = dated.reduce((a: any, b: any) => (b.timestamp >= a.timestamp ? b : a));
  return ["otp", "magiclink", "email"].includes(latest?.method ?? "");
}

// ─── Context type ─────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  /**
   * EFFECTIVE profile. When an admin is impersonating, `role` is overridden to
   * the impersonated role so every existing `profile.role` consumer (RequireAdmin,
   * sidebar getSections, DashboardIndex, TopNav, SiteNav, Index, Login) reflects
   * the preview automatically — no per-consumer edits. Otherwise === realProfile.
   */
  profile: UserProfile | null;
  /** The true, never-overridden profile (the real signed-in identity). */
  realProfile: UserProfile | null;
  /** The true role of the signed-in user, or null before load. */
  realRole: "admin" | "user" | null;
  /** True when a real admin is actively previewing as a role via a live token. */
  isImpersonating: boolean;
  /**
   * Start, switch, or stop impersonation. No-op unless realRole === 'admin'.
   * - role != null: awaits POST /api/admin/impersonation {action:'start',role};
   *   on success stores role+token (sessionStorage + state); on failure THROWS
   *   and does NOT switch.
   * - role == null: best-effort POST {action:'stop'}, then ALWAYS clears local
   *   state + sessionStorage so Exit can never get stuck.
   */
  setImpersonatedRole: (role: "admin" | "user" | null) => Promise<void>;
  session: Session | null;
  loading: boolean;
  /**
   * True when admin gating is satisfied: the user is not an admin (no gate),
   * or the admin has proven email possession this session (via magic link,
   * email-OTP redirect, or the AdminEmailVerifyWall step-up). RequireAdmin
   * checks this; defaults to false for admins until proven.
   */
  adminVerified: boolean;
  /** Sends a 6-digit email OTP to the current user for the admin step-up. Throws on error. */
  sendAdminEmailCode: () => Promise<void>;
  /** Verifies the typed 6-digit code; on success marks the session admin-verified. Throws on error. */
  verifyAdminEmailCode: (code: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signUp: (
    email: string,
    password: string,
    meta: { first_name?: string; last_name?: string; brokerage?: string }
  ) => Promise<void>;
  /** Sends a 6-digit signup OTP (creates the user if new). Throws on error. */
  sendSignupCode: (email: string) => Promise<void>;
  /**
   * Verifies the typed signup OTP; a session is established on success. Returns
   * the verified `User` (from verifyOtp) so callers have the authoritative user
   * id to branch on deterministically. Throws on error.
   */
  verifySignupCode: (email: string, code: string) => Promise<User>;
  /**
   * Read-only, direct fetch of a profile row by user id (no state mutation).
   * Used post-verify to deterministically decide existing-vs-new account.
   */
  fetchProfileSnapshot: (userId: string) => Promise<UserProfile | null>;
  /** Sets the password for the currently-authenticated (just-verified) user. Throws on error. */
  setPassword: (password: string) => Promise<void>;
  /**
   * Persists onboarding details: writes auth metadata (best-effort) and the
   * `user_profiles` row. If the migration-105 columns are absent, retries with
   * only the pre-existing columns so onboarding never hard-fails. Refreshes
   * the local profile at the end.
   */
  completeOnboarding: (details: OnboardingDetails) => Promise<void>;
  listIdentities: () => Promise<UserIdentity[]>;
  linkIdentity: (provider: "google" | "azure") => Promise<void>;
  unlinkIdentity: (identity: UserIdentity) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  realProfile: null,
  realRole: null,
  isImpersonating: false,
  setImpersonatedRole: async () => {},
  session: null,
  loading: true,
  adminVerified: false,
  sendAdminEmailCode: async () => {},
  verifyAdminEmailCode: async () => {},
  signInWithMagicLink: async () => {},
  signInWithPassword: async () => {},
  signInWithGoogle: async () => {},
  signInWithMicrosoft: async () => {},
  signUp: async () => {},
  sendSignupCode: async () => {},
  verifySignupCode: async () => ({} as User),
  fetchProfileSnapshot: async () => null,
  setPassword: async () => {},
  completeOnboarding: async () => {},
  listIdentities: async () => [],
  linkIdentity: async () => {},
  unlinkIdentity: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // `realProfile` is always the true identity. The EFFECTIVE `profile` exposed
  // on the context is derived below (role overridden while impersonating).
  const [realProfile, setRealProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(
    () => readImpersonation()
  );
  // isAdminVerified reads sessionStorage (non-reactive), so forceRecheck() bumps
  // a reducer to re-render after a marker write (typed-code verify or amr-mark).
  const [, forceRecheck] = useReducer((x) => x + 1, 0);

  const realRole = realProfile?.role ?? null;
  // Only honor impersonation locally when the real user is an admin — mirrors
  // the server, which never escalates a non-admin token.
  const isImpersonating = impersonation !== null && realRole === "admin";
  // EFFECTIVE profile — role overridden while an admin previews another role.
  const profile = useMemo<UserProfile | null>(() => {
    if (!realProfile) return null;
    if (isImpersonating && impersonation) {
      return { ...realProfile, role: impersonation.role };
    }
    return realProfile;
  }, [realProfile, isImpersonating, impersonation]);

  // setProfile shim so existing fetch/refresh code keeps writing the REAL profile.
  const setProfile = setRealProfile;

  // Derived during render (not in an effect) so the first non-loading admin
  // render already reads the correct value — no one-frame flash of admin content.
  // Fail-closed while the profile is unknown: an admin whose profile has not yet
  // loaded is gated, never briefly granted. Uses the EFFECTIVE profile so a
  // preview-as-user admin isn't gated, and the wall returns when back as admin.
  const adminVerified =
    !user ? true :
    profile == null ? false :        // profile still loading → gated (fail-closed)
    profile.role !== "admin" ? true :
    isAdminVerified(user.id);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from("user_profiles")
      .select()
      .eq("user_id", userId)
      .single();

    if (data) {
      setProfile(data as UserProfile);
    } else {
      // First login — create profile with signup metadata if available
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const meta = currentUser?.user_metadata;
      let firstName: string | null = meta?.first_name ?? null;
      let lastName: string | null = meta?.last_name ?? null;
      if (!firstName) {
        const fullName = meta?.full_name || meta?.name;
        if (typeof fullName === "string" && fullName.trim()) {
          const parts = fullName.trim().split(/\s+/);
          firstName = parts[0];
          lastName = parts.slice(1).join(" ") || null;   // mononym → null, never undefined
        }
      }
      const { data: newProfile } = await supabase
        .from("user_profiles")
        .insert({
          user_id: userId,
          email: currentUser?.email,
          first_name: firstName,
          last_name: lastName,
          brokerage: meta?.brokerage || null,
        })
        .select()
        .single();
      if (newProfile) setProfile(newProfile as UserProfile);
    }
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  // Read-only snapshot of a profile row (mirrors fetchProfile's query but never
  // mutates state). Returns null when no row exists yet — the authoritative
  // signal that a just-verified account is genuinely new.
  async function fetchProfileSnapshot(userId: string): Promise<UserProfile | null> {
    const { data } = await supabase
      .from("user_profiles")
      .select()
      .eq("user_id", userId)
      .maybeSingle();
    return (data as UserProfile | null) ?? null;
  }

  async function sendAdminEmailCode() {
    if (!user?.email) throw new Error("No signed-in user");
    const { error } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false, emailRedirectTo: AUTH_CALLBACK_URL },
    });
    if (error) throw error;
  }

  async function verifyAdminEmailCode(code: string) {
    if (!user?.email) throw new Error("No signed-in user");
    const { data, error } = await supabase.auth.verifyOtp({
      email: user.email,
      token: code,
      type: "email",
    });
    if (error) throw error;
    const verifiedId = data.user?.id ?? user.id;
    markAdminVerified(verifiedId);
    forceRecheck();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Email-possession proof comes from the signed JWT `amr` claim, never
        // from the URL — a password session has amr `password` and is not marked.
        if (sessionProvesEmailPossession(s)) {
          markAdminVerified(s.user.id);
          forceRecheck();
        }
        fetchProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Same JWT-amr check on every auth state change (sign-in, token refresh,
        // tab refocus). Magic-link / email-OTP sessions are marked; password
        // sessions never are.
        if (sessionProvesEmailPossession(s)) {
          markAdminVerified(s.user.id);
          forceRecheck();
        }
        fetchProfile(s.user.id).then(() => {
          migrateLocalPresets().catch(() => {});
        });
      } else {
        // Session became null (sign-out, token expiry/revocation, another-tab
        // SIGNED_OUT broadcast). Drop ALL admin-verified markers in this tab so a
        // later same-tab password login can never read a stale marker and skip
        // the wall.
        setProfile(null);
        clearAllAdminVerified();
        forceRecheck();
        // A sign-out event (e.g. from another tab) must not leave a stale
        // impersonation pair behind.
        clearImpersonationStorage();
        setImpersonation(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signInWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: AUTH_CALLBACK_URL,
      },
    });
    if (error) throw error;
  }

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: AUTH_CALLBACK_URL, queryParams: { prompt: "select_account" } },
    });
    if (error) throw error;
  }

  async function signInWithMicrosoft() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: AUTH_CALLBACK_URL,
        scopes: "email openid profile",
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
  }

  async function signUp(
    email: string,
    password: string,
    meta: { first_name?: string; last_name?: string; brokerage?: string }
  ) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta, emailRedirectTo: AUTH_CALLBACK_URL },
    });
    if (error) throw error;
  }

  // ── Immersive signup: OTP → password → onboarding ──────────────────────────
  async function sendSignupCode(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: AUTH_CALLBACK_URL },
    });
    if (error) throw error;
  }

  async function verifySignupCode(email: string, code: string): Promise<User> {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error) throw error;
    if (!data.user) throw new Error("Verification succeeded but no user was returned.");
    // Session is now live; onAuthStateChange picks it up and fetches the profile.
    // Returning the verified user lets the caller branch on the authoritative id.
    return data.user;
  }

  async function setPassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }

  async function completeOnboarding(details: OnboardingDetails) {
    const firstName = details.firstName.trim();
    const lastName = details.lastName.trim();
    const brokerage = details.brokerage.trim();

    // 1) Auth metadata — best-effort, never blocks the flow.
    try {
      await supabase.auth.updateUser({
        data: {
          first_name: firstName,
          last_name: lastName,
          brokerage,
          persona: details.persona,
          signup_source: details.signupSource,
          signup_source_detail: details.signupSourceDetail,
        },
      });
    } catch {
      /* metadata is non-critical — the profile row below is the source of truth */
    }

    // 2) Profile row. Upsert (onConflict user_id) rather than update: the row is
    //    normally created by onAuthStateChange, but upsert closes the silent
    //    0-row hole where a missing row made a no-op update look like success.
    //    `role` is intentionally omitted — it is NOT NULL DEFAULT 'user' (migration
    //    001), so a fresh insert gets the default and an existing admin's role is
    //    never clobbered. Try the full write (incl. migration-105 columns); if those
    //    columns don't exist yet on the shared DB, retry with only the pre-existing
    //    columns. If the RETRY also errors, THROW so the dialog surfaces it.
    const uid = user?.id;
    if (uid) {
      const { error } = await supabase
        .from("user_profiles")
        .upsert(
          {
            user_id: uid,
            first_name: firstName,
            last_name: lastName,
            brokerage,
            persona: details.persona,
            signup_source: details.signupSource,
            signup_source_detail: details.signupSourceDetail,
          },
          { onConflict: "user_id" },
        );
      if (error) {
        // persona/source is best-effort until migration 105 lands; core fields
        // must persist. A retry failure is a real failure — throw it.
        const { error: retryError } = await supabase
          .from("user_profiles")
          .upsert(
            { user_id: uid, first_name: firstName, last_name: lastName, brokerage },
            { onConflict: "user_id" },
          );
        if (retryError) throw retryError;
      }
    }

    await refreshProfile();
  }

  async function listIdentities(): Promise<UserIdentity[]> {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error) throw error;
    return data?.identities ?? [];
  }

  async function linkIdentity(provider: "google" | "azure") {
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard/account/profile` },
    });
    if (error) throw error;
  }

  async function unlinkIdentity(identity: UserIdentity) {
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) throw error;
  }

  /**
   * Start / switch / stop impersonation. Only an admin (realRole === 'admin')
   * may act; for everyone else this is a no-op. See the AuthContextType doc.
   */
  async function setImpersonatedRole(role: "admin" | "user" | null) {
    if (realRole !== "admin") return;

    if (role === null) {
      // STOP. Best-effort server revoke, then ALWAYS clear locally so Exit
      // can't get stuck even if the network call fails.
      try {
        await authedFetch("/api/admin/impersonation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        });
      } catch {
        // swallow — local clear below is the source of truth for the UI
      }
      clearImpersonationStorage();
      setImpersonation(null);
      return;
    }

    // START. Mint a token server-side; only switch on success.
    const res = await authedFetch("/api/admin/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", role }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Failed to start impersonation (${res.status}): ${text || res.statusText}`
      );
    }
    const data = (await res.json()) as { token: string; role: "admin" | "user" };
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(IMPERSONATE_ROLE_KEY, data.role);
      sessionStorage.setItem(IMPERSONATE_TOKEN_KEY, data.token);
    }
    setImpersonation({ role: data.role, token: data.token });
  }

  async function signOut() {
    const uid = user?.id;
    // Best-effort revoke of any active impersonation before tearing down auth.
    if (impersonation) {
      try {
        await authedFetch("/api/admin/impersonation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        });
      } catch {
        // ignore — we clear local state regardless
      }
    }
    clearImpersonationStorage();
    setImpersonation(null);
    await supabase.auth.signOut();
    if (uid) clearAdminVerified(uid);
    setUser(null);
    setSession(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        realProfile,
        realRole,
        isImpersonating,
        setImpersonatedRole,
        session,
        loading,
        adminVerified,
        sendAdminEmailCode,
        verifyAdminEmailCode,
        signInWithMagicLink,
        signInWithPassword,
        signInWithGoogle,
        signInWithMicrosoft,
        signUp,
        sendSignupCode,
        verifySignupCode,
        fetchProfileSnapshot,
        setPassword,
        completeOnboarding,
        listIdentities,
        linkIdentity,
        unlinkIdentity,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
