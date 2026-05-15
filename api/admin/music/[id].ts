// api/admin/music/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const ALLOWED_MOOD_TAGS = ["upbeat", "warm", "celebratory", "cinematic", "neutral"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "PATCH") return handlePatch(req, res, id);
  if (req.method === "DELETE") return handleDelete(req, res, id);

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handlePatch(req: VercelRequest, res: VercelResponse, id: string) {
  const supabase = getSupabase();
  const body = req.body ?? {};

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }

  if (body.mood_tag !== undefined) {
    if (!(ALLOWED_MOOD_TAGS as readonly string[]).includes(body.mood_tag)) {
      return res.status(400).json({
        error: `mood_tag must be one of: ${ALLOWED_MOOD_TAGS.join(", ")}`,
      });
    }
    patch.mood_tag = body.mood_tag;
  }

  if (body.license !== undefined) {
    patch.license = typeof body.license === "string" ? body.license.trim() || null : null;
  }

  if (body.attribution !== undefined) {
    patch.attribution =
      typeof body.attribution === "string" ? body.attribution.trim() || null : null;
  }

  if (typeof body.active === "boolean") {
    patch.active = body.active;
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "no editable fields provided" });
  }

  const { data: track, error } = await supabase
    .from("music_tracks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ track });
}

async function handleDelete(_req: VercelRequest, res: VercelResponse, id: string) {
  // Soft-delete: set active=false. We never remove the row or storage file
  // because live rendered videos reference the public URL.
  const supabase = getSupabase();

  const { error } = await supabase
    .from("music_tracks")
    .update({ active: false })
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
