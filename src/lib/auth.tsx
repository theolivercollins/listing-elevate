import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
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
        fetchProfile(s.user.id).then(() => {
          // Migrate any localStorage presets to server on login
          migrateLocalPresets().catch(() => {});
        });
      } else {
        setProfile(null);
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
  }

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signInWithMagicLink, signInWithPassword, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
