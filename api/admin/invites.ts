import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/db.js";

// POST /api/admin/invites
//   body: { email: string }
// Sends a Supabase invite email to the given address. Admin-only.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email address is required" });
  }

  const supabase = getSupabase();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://listingelevate.com"}/dashboard`;

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, userId: data.user?.id ?? null });
}
