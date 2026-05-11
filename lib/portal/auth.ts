import type { VercelRequest } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnerOk { ok: true; userId: string; }
export interface OwnerErr { ok: false; status: number; error: string; }

export async function requireOwner(
  req: VercelRequest,
  supabase: SupabaseClient,
  orderId: string,
): Promise<OwnerOk | OwnerErr> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing bearer token" };
  const accessToken = auth.slice(7);

  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) return { ok: false, status: 401, error: "invalid session" };

  const { data: order, error: ordErr } = await supabase
    .from("portal_orders")
    .select("id, owner_id")
    .eq("id", orderId)
    .maybeSingle();
  if (ordErr) return { ok: false, status: 500, error: ordErr.message };
  if (!order) return { ok: false, status: 404, error: "order not found" };
  if (order.owner_id !== userData.user.id) return { ok: false, status: 403, error: "not order owner" };

  return { ok: true, userId: userData.user.id };
}
