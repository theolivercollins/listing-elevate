import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/users
//
// Lists user_profiles enriched with:
//   - property_count       : count of properties.submitted_by = user.user_id
//   - total_spend_cents    : sum of cost_events.cost_cents for those properties
//   - last_active_at       : max(properties.created_at) for that user
//
// Returns up to 200 rows for now (no pagination yet — small list).

const MAX_USERS = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();

  // Fetch users.
  const { data: profiles, error: pErr } = await supabase
    .from("user_profiles")
    .select("user_id, email, role, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_USERS);
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!profiles || profiles.length === 0) {
    return res.status(200).json({ users: [] });
  }

  const userIds = profiles.map((p) => p.user_id as string);

  // Fetch all properties for these users (one query, cap rows).
  const { data: props, error: propErr } = await supabase
    .from("properties")
    .select("id, submitted_by, created_at")
    .in("submitted_by", userIds)
    .limit(5000);
  if (propErr) return res.status(500).json({ error: propErr.message });

  const propsByUser = new Map<string, { count: number; lastAt: string | null; propertyIds: string[] }>();
  for (const row of props ?? []) {
    const uid = row.submitted_by as string;
    if (!uid) continue;
    const bucket = propsByUser.get(uid) ?? { count: 0, lastAt: null, propertyIds: [] };
    bucket.count += 1;
    const createdAt = row.created_at as string;
    if (!bucket.lastAt || createdAt > bucket.lastAt) bucket.lastAt = createdAt;
    bucket.propertyIds.push(row.id as string);
    propsByUser.set(uid, bucket);
  }

  const allPropertyIds = Array.from(propsByUser.values()).flatMap((b) => b.propertyIds);
  let spendByProperty = new Map<string, number>();
  if (allPropertyIds.length > 0) {
    const { data: costs, error: cErr } = await supabase
      .from("cost_events")
      .select("property_id, cost_cents")
      .in("property_id", allPropertyIds)
      .limit(20000);
    if (cErr) return res.status(500).json({ error: cErr.message });
    for (const row of costs ?? []) {
      const pid = row.property_id as string;
      if (!pid) continue;
      spendByProperty.set(pid, (spendByProperty.get(pid) ?? 0) + ((row.cost_cents as number) ?? 0));
    }
  }

  const users = profiles.map((p) => {
    const uid = p.user_id as string;
    const bucket = propsByUser.get(uid);
    const total_spend_cents = (bucket?.propertyIds ?? []).reduce(
      (acc, pid) => acc + (spendByProperty.get(pid) ?? 0),
      0,
    );
    return {
      id: uid,
      email: p.email as string,
      role: (p.role as string) ?? "user",
      created_at: p.created_at as string,
      property_count: bucket?.count ?? 0,
      total_spend_cents,
      last_active_at: bucket?.lastAt ?? null,
    };
  });

  return res.status(200).json({ users });
}
