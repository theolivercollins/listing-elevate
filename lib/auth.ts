import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "./db.js";

export interface AuthUser {
  id: string;
  email: string;
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
  colors: { primary: string; secondary: string };
  presets: unknown[];
  created_at: string;
  updated_at: string;
}

export async function verifyAuth(
  req: VercelRequest
): Promise<{ user: AuthUser; profile: UserProfile } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const supabase = getSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  // Fetch or create profile
  let { data: profile } = await supabase
    .from("user_profiles")
    .select()
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    const { data: newProfile, error: insertErr } = await supabase
      .from("user_profiles")
      .insert({ user_id: user.id, email: user.email })
      .select()
      .single();
    if (insertErr) return null;
    profile = newProfile;
  }

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as UserProfile,
  };
}

export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse
): Promise<{ user: AuthUser; profile: UserProfile } | null> {
  const auth = await verifyAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return auth;
}

export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse
): Promise<{ user: AuthUser; profile: UserProfile } | null> {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (auth.profile.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return auth;
}
