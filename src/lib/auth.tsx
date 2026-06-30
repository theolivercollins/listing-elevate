import { createContext, useContext, useEffect, useReducer, useState, ReactNode } from "react";
import { supabase, AUTH_CALLBACK_URL } from "./supabase";
import { migrateLocalPresets } from "./presets";
import type { User, Session } from "@supabase/supabase-js";

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
  profile: UserProfile | null;
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
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  adminVerified: false,
  sendAdminEmailCode: async () => {},
  verifyAdminEmailCode: async () => {},
  signInWithMagicLink: async () => {},
  signInWithPassword: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // isAdminVerified reads sessionStorage (non-reactive), so forceRecheck() bumps
  // a reducer to re-render after a marker write (typed-code verify or amr-mark).
  const [, forceRecheck] = useReducer((x) => x + 1, 0);

  // Derived during render (not in an effect) so the first non-loading admin
  // render already reads the correct value — no one-frame flash of admin content.
  // Fail-closed while the profile is unknown: an admin whose profile has not yet
  // loaded is gated, never briefly granted.
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
    const uid = user?.id;
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
        session,
        loading,
        adminVerified,
        sendAdminEmailCode,
        verifyAdminEmailCode,
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
