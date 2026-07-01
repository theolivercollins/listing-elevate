import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
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

/**
 * Present (non-persisted) on the verifyAuth result ONLY when an admin is
 * actively impersonating via a valid token. `profile.role` is already
 * overridden to `as` in that case; this field is the audit/context breadcrumb.
 */
export interface ImpersonationContext {
  realRole: "admin";
  as: "admin" | "user";
  sessionId: string;
}

export interface VerifyAuthResult {
  user: AuthUser;
  profile: UserProfile;
  impersonating?: ImpersonationContext;
}

export interface VerifyAuthOptions {
  /**
   * When true, the `x-impersonate-token` header is ignored and the REAL
   * profile is always returned. The impersonation endpoint passes this so
   * STOP works while impersonating (the admin must be able to revoke their
   * own session even though their effective role is currently `user`).
   */
  ignoreImpersonation?: boolean;
}

const IMPERSONATE_HEADER = "x-impersonate-token";

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function headerValue(req: VercelRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

export async function verifyAuth(
  req: VercelRequest,
  opts: VerifyAuthOptions = {}
): Promise<VerifyAuthResult | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const supabase = getSupabase();

  // Cast to `any` because Vercel's serverless tsc resolves @supabase/supabase-js's
  // bundled .d.ts to the SupabaseAuthClient declaration that extends `AuthClient`
  // (a `typeof GoTrueClient` const). The class-extends-const chain confuses tsc
  // in Vercel's build env even though local tsc resolves it fine. getUser exists
  // at runtime regardless. See: build dpl_5FYy9Xmx9JRF32m4pcbuT4xC1EaU.
  const {
    data: { user },
    error,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = await (supabase.auth as any).getUser(token);
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

  const realProfile = profile as UserProfile;
  const authUser: AuthUser = { id: user.id, email: user.email! };

  // ─── Impersonation honoring ──────────────────────────────────────────────
  // Only honor a token when (a) not explicitly ignored, (b) the header is
  // present, and (c) the REAL profile is admin. We then require a live session
  // row whose admin_user_id matches the real JWT identity. Anything short of
  // that returns the REAL profile unchanged — NEVER escalate.
  const impersonateToken = headerValue(req, IMPERSONATE_HEADER);
  if (
    !opts.ignoreImpersonation &&
    impersonateToken &&
    realProfile.role === "admin"
  ) {
    const tokenHash = sha256Hex(impersonateToken);
    const { data: sessionRow } = await supabase
      .from("impersonation_sessions")
      .select("id, impersonated_role, admin_user_id, revoked_at, expires_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .eq("admin_user_id", authUser.id)
      .single();

    if (sessionRow) {
      const as = sessionRow.impersonated_role as "admin" | "user";
      return {
        user: authUser,
        profile: { ...realProfile, role: as },
        impersonating: { realRole: "admin", as, sessionId: sessionRow.id },
      };
    }

    // Token was supplied but did not resolve to a live, owned session. Do NOT
    // escalate or error — fall through to the real profile, but warn (a present
    // token that can't be honored usually means expired/revoked/forged/mismatch).
    console.warn(
      `[auth] x-impersonate-token present but rejected for admin ${authUser.id} (expired/revoked/mismatched/forged)`
    );
  }

  return { user: authUser, profile: realProfile };
}

/**
 * Cache-safety for authed responses. Impersonation makes the SAME URL return
 * different bodies per (Authorization, x-impersonate-token) pair, so responses
 * must never be shared by a cache.
 */
export function setNoStore(res: VercelResponse): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization, x-impersonate-token");
}

export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
  opts: VerifyAuthOptions = {}
): Promise<VerifyAuthResult | null> {
  setNoStore(res);
  const auth = await verifyAuth(req, opts);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return auth;
}

export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
  opts: VerifyAuthOptions = {}
): Promise<VerifyAuthResult | null> {
  const auth = await requireAuth(req, res, opts);
  if (!auth) return null;
  if (auth.profile.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return auth;
}
