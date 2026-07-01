import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase, AUTH_CALLBACK_URL } from "./supabase";
import { migrateLocalPresets } from "./presets";
import { authedFetch } from "./api";
import type { User, Session, Factor } from "@supabase/supabase-js";

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
}

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
   * True when the session is aal1 AND the user has a verified TOTP factor
   * (i.e. nextLevel === 'aal2'). RequireAuth uses this to gate the app
   * until the user completes the MFA challenge.
   */
  mfaRequired: boolean;
  /**
   * All verified TOTP factors for the current user. Populated after load;
   * empty array until auth init completes or for users with no factors.
   */
  mfaVerifiedFactors: Factor[];
  /**
   * Challenge the first verified TOTP factor with the given 6-digit code,
   * then re-check MFA state. Throws on wrong code or network error.
   * After this resolves successfully, mfaRequired becomes false.
   */
  completeMfaChallenge: (code: string) => Promise<void>;
  /**
   * Re-fetches the factor list and AAL state. Call after enrollment or
   * unenrollment to keep RequireAdmin's factor check current.
   */
  refreshMfaFactors: () => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
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
  mfaRequired: false,
  mfaVerifiedFactors: [],
  completeMfaChallenge: async () => {},
  refreshMfaFactors: async () => {},
  signInWithMagicLink: async () => {},
  signInWithPassword: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // `realProfile` is always the true identity. The EFFECTIVE `profile` exposed
  // on the context is derived below (role overridden while impersonating).
  const [realProfile, setRealProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerifiedFactors, setMfaVerifiedFactors] = useState<Factor[]>([]);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(
    () => readImpersonation()
  );

  const realRole = realProfile?.role ?? null;
  // Only honor impersonation locally when the real user is an admin — mirrors
  // the server, which never escalates a non-admin token.
  const isImpersonating = impersonation !== null && realRole === "admin";
  const profile = useMemo<UserProfile | null>(() => {
    if (!realProfile) return null;
    if (isImpersonating && impersonation) {
      return { ...realProfile, role: impersonation.role };
    }
    return realProfile;
  }, [realProfile, isImpersonating, impersonation]);

  // setProfile shim so existing fetch/refresh code keeps writing the REAL profile.
  const setProfile = setRealProfile;

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
      const { data: newProfile } = await supabase
        .from("user_profiles")
        .insert({
          user_id: userId,
          email: currentUser?.email,
          first_name: meta?.first_name || null,
          last_name: meta?.last_name || null,
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

  /**
   * Fetches the current factor list and authenticator assurance level,
   * then updates mfaVerifiedFactors and mfaRequired state.
   */
  async function checkMfaState() {
    const [factorsResult, aalResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    // If either call errors transiently, skip state update so we preserve
    // the prior mfaVerifiedFactors / mfaRequired values. Without this guard
    // a network blip would clobber a properly-enrolled aal2 admin's factors
    // to [] and wrongly redirect them to ?mfa_setup=1.
    if (factorsResult.error || aalResult.error) return;
    const verified = (factorsResult.data?.totp ?? []).filter(
      (f) => f.status === "verified"
    );
    setMfaVerifiedFactors(verified);
    const aal = aalResult.data;
    setMfaRequired(aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2");
  }

  async function refreshMfaFactors() {
    await checkMfaState();
  }

  /**
   * Creates a fresh challenge for the user's first verified TOTP factor,
   * verifies the supplied 6-digit code, then re-checks AAL state.
   * On success mfaRequired becomes false and the app gate opens.
   */
  async function completeMfaChallenge(code: string) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
    if (!factor) throw new Error("No verified TOTP factor found");

    const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (cErr) throw cErr;

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: ch.id,
      code,
    });
    if (vErr) throw vErr;

    await checkMfaState();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        Promise.all([fetchProfile(s.user.id), checkMfaState()]).finally(() =>
          setLoading(false)
        );
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
        fetchProfile(s.user.id).then(() => {
          // Migrate any localStorage presets to server on login
          migrateLocalPresets().catch(() => {});
        });
        // Run MFA check in parallel — doesn't block the profile fetch
        checkMfaState();
      } else {
        setProfile(null);
        setMfaRequired(false);
        setMfaVerifiedFactors([]);
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
    setUser(null);
    setSession(null);
    setProfile(null);
    setMfaRequired(false);
    setMfaVerifiedFactors([]);
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
        mfaRequired,
        mfaVerifiedFactors,
        completeMfaChallenge,
        refreshMfaFactors,
        signInWithMagicLink,
        signInWithPassword,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
