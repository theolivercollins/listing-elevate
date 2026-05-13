import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/recent-listings?limit=10
//
// Returns the latest N properties enriched with customer email + total
// cost from cost_events. Default limit = 10.
//
// Schema notes (verified against lib/types.ts + supabase/migrations/):
//   - properties.submitted_by  → auth UID (not user_id)
//   - properties has NO order_id column (order_id lives on iteration tables)
//   - photos.file_url           → source URL (not storage_url)
//   - photos has NO position column; ordered by created_at ASC
//   - user_profiles.user_id    → FK to auth.users (the join key for submitted_by)
//   - user_profiles.id         → internal PK UUID (not used for the join)

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt((req.query.limit as string) ?? "", 10) || DEFAULT_LIMIT),
  );

  const supabase = getSupabase();

  const { data: properties, error: pErr } = await supabase
    .from("properties")
    .select("id, address, status, created_at, submitted_by")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!properties || properties.length === 0) {
    return res.status(200).json({ listings: [] });
  }

  const propertyIds = properties.map((p) => p.id as string);
  // submitted_by is the auth UID — look up user_profiles by user_id FK
  const submittedByIds = Array.from(
    new Set(
      properties
        .map((p) => p.submitted_by as string | null)
        .filter(Boolean) as string[],
    ),
  );

  // Parallel: cost rollup + user emails + first photo per property
  const [costRes, profileRes, photoRes] = await Promise.all([
    supabase
      .from("cost_events")
      .select("property_id, cost_cents")
      .in("property_id", propertyIds),
    submittedByIds.length
      ? supabase
          .from("user_profiles")
          .select("user_id, email")
          .in("user_id", submittedByIds)
      : Promise.resolve({
          data: [] as Array<{ user_id: string; email: string }>,
          error: null,
        }),
    supabase
      .from("photos")
      .select("property_id, file_url")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: true }),
  ]);

  if (costRes.error) return res.status(500).json({ error: costRes.error.message });
  if (profileRes.error) return res.status(500).json({ error: profileRes.error.message });
  if (photoRes.error) return res.status(500).json({ error: photoRes.error.message });

  const costMap = new Map<string, number>();
  for (const row of costRes.data ?? []) {
    const pid = row.property_id as string;
    costMap.set(pid, (costMap.get(pid) ?? 0) + ((row.cost_cents as number) ?? 0));
  }

  // Key by user_id (auth UID) so we can look up via submitted_by
  const emailMap = new Map<string, string>();
  for (const row of profileRes.data ?? []) {
    emailMap.set(row.user_id as string, row.email as string);
  }

  const thumbMap = new Map<string, string>();
  for (const row of photoRes.data ?? []) {
    const pid = row.property_id as string;
    if (!thumbMap.has(pid)) thumbMap.set(pid, row.file_url as string);
  }

  const listings = properties.map((p) => ({
    id: p.id as string,
    address: p.address as string,
    customer_id: (p.submitted_by as string | null) ?? null,
    customer_email: emailMap.get((p.submitted_by as string) ?? "") ?? null,
    status: p.status as string,
    cost_cents: costMap.get(p.id as string) ?? 0,
    created_at: p.created_at as string,
    thumbnail_url: thumbMap.get(p.id as string) ?? null,
  }));

  return res.status(200).json({ listings });
}
