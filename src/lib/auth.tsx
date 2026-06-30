import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase, AUTH_CALLBACK_URL } from "./supabase";
import { migrateLocalPresets } from "./presets";
import type { User, Session, Factor } from "@supabase/supabase-js";

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
  colors: { primary: string; secondary: string };
  presets: unknown[];
  created_at: string;
  updated_at: string;
  voice_clone_status?: "none" | "requested" | "enrolling" | "ready" | "failed" | null;
  elevenlabs_voice_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerifiedFactors, setMfaVerifiedFactors] = useState<Factor[]>([]);

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

  async function signOut() {
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
