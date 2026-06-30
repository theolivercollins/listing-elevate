import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes } from "node:crypto";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/db.js";

// POST /api/admin/impersonation
//   body: { action: 'start', role: 'admin'|'user' }  → mint a session token
//   body: { action: 'stop' }                          → revoke caller's active sessions
//
// Admin-only. Authenticated with ignoreImpersonation:true so STOP still works
// while the caller is impersonating (effective role would otherwise be `user`).
// The session row IS the audit trail + the sole authority for honoring a token;
// the raw token is returned exactly once and never stored (only its SHA-256).

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const IMPERSONATABLE_ROLES = ["admin", "user"] as const;
type ImpersonatableRole = (typeof IMPERSONATABLE_ROLES)[number];

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function isImpersonatableRole(value: unknown): value is ImpersonatableRole {
  return (
    typeof value === "string" &&
    (IMPERSONATABLE_ROLES as readonly string[]).includes(value)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ignoreImpersonation:true → assert the REAL identity is admin (not the
  // effective/impersonated role), so an admin can STOP from within a session.
  const auth = await requireAdmin(req, res, { ignoreImpersonation: true });
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: unknown; role?: unknown };
  const { action } = body;

  const supabase = getSupabase();

  if (action === "start") {
    if (!isImpersonatableRole(body.role)) {
      return res
        .status(400)
        .json({ error: "role must be one of: admin, user" });
    }

    // Audit hygiene: revoke the caller's prior active sessions before minting
    // a new one. Keeps one active session per admin and a clean audit trail
    // (an admin who clicks "start" twice shouldn't leave a dangling live
    // token from the first session). Best-effort — a failure here must not
    // block starting the new session; the old row simply ages out at its
    // own expires_at.
    const { error: revokeError } = await supabase
      .from("impersonation_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("admin_user_id", auth.user.id)
      .is("revoked_at", null);
    if (revokeError) {
      console.warn(
        `[impersonation] failed to revoke prior sessions for admin ${auth.user.id}: ${revokeError.message}`
      );
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const { error } = await supabase.from("impersonation_sessions").insert({
      token_hash: tokenHash,
      admin_user_id: auth.user.id,
      admin_email: auth.user.email,
      impersonated_role: body.role,
      expires_at: expiresAt,
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res
      .status(200)
      .json({ token: rawToken, role: body.role, expiresAt });
  }

  if (action === "stop") {
    // Revoke ALL of the caller's active sessions (defensive: usually one).
    const { error } = await supabase
      .from("impersonation_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("admin_user_id", auth.user.id)
      .is("revoked_at", null);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  }

  return res
    .status(400)
    .json({ error: "action must be one of: start, stop" });
}
