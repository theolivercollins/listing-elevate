import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

/**
 * GET /api/admin/prompt-lab/assemblies?session_id=<uuid>
 *
 * Returns prompt_lab_assemblies rows for the given session, ordered by
 * created_at DESC, limited to 20 rows.
 *
 * Response: PromptLabAssembly[]
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const sessionId = req.query.session_id as string | undefined;
  const batchLabel = req.query.batch_label as string | undefined;
  if (!sessionId && !batchLabel) {
    return res.status(400).json({ error: "session_id or batch_label query parameter required" });
  }

  const supabase = getSupabase();

  let query = supabase
    .from("prompt_lab_assemblies")
    .select(
      "id, status, assembled_url, duration_seconds, iteration_order, pipeline_version, created_at, completed_at, error",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  } else {
    query = query.eq("batch_label", batchLabel!);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data ?? []);
}
