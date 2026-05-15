// api/blog/ai/memories.ts
//
// GET: list active memories for the single Sierra site.
// DELETE ?id=…: soft-delete (active=false) a memory.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { listMemories, deactivateMemory } from "../../../lib/blog-engine/ally-memory.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  if (req.method === "GET") {
    const memories = await listMemories(supabase, site.id);
    return res.status(200).json({ memories });
  }

  if (req.method === "DELETE") {
    const id = (req.query.id as string | undefined)?.trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const ok = await deactivateMemory(supabase, id);
    if (!ok) return res.status(500).json({ error: "delete failed" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
