import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../../lib/portal/auth.js";
import {
  objectPathFor,
  createSignedUploadUrl,
  STORAGE_CONSTANTS,
} from "../../../../../../../lib/portal/storage.js";
import { createVersionRow } from "../../../../../../../lib/portal/deliverables.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  if (!orderId || !did) return res.status(400).json({ error: "order + deliverable id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const body = (req.body ?? {}) as {
    file_name?: string; mime_type?: string; file_size_bytes?: number; upload_note?: string;
  };
  if (!body.file_name || !body.mime_type || typeof body.file_size_bytes !== "number") {
    return res.status(400).json({ error: "file_name, mime_type, file_size_bytes required" });
  }
  if (!body.mime_type.startsWith("video/")) {
    return res.status(400).json({ error: "mime_type must be video/*" });
  }
  if (body.file_size_bytes > STORAGE_CONSTANTS.MAX_FILE_BYTES) {
    return res.status(400).json({ error: `file too large (>${STORAGE_CONSTANTS.MAX_FILE_BYTES} bytes)` });
  }

  // Resolve deliverable → confirm it belongs to this order
  const { data: deliv, error: delivErr } = await supabase
    .from("portal_deliverables")
    .select("id, order_id")
    .eq("id", did)
    .maybeSingle();
  if (delivErr) return res.status(500).json({ error: delivErr.message });
  if (!deliv || deliv.order_id !== orderId) return res.status(404).json({ error: "deliverable not found" });

  try {
    // Use a placeholder path for the row, then compute the real path after we
    // know the assigned version number, then update.
    const tmpPath = "__pending__";
    const versionRow = await createVersionRow(supabase, {
      deliverableId: did,
      fileName: body.file_name,
      mimeType: body.mime_type,
      fileSizeBytes: body.file_size_bytes,
      uploadNote: body.upload_note,
      uploadedBy: ownerCheck.userId,
    }, tmpPath);

    const storagePath = objectPathFor({
      ownerId: ownerCheck.userId,
      orderId,
      deliverableId: did,
      version: versionRow.version,
      fileName: body.file_name,
    });

    const { error: updErr } = await supabase
      .from("portal_deliverable_versions")
      .update({ storage_path: storagePath })
      .eq("id", versionRow.id);
    if (updErr) throw new Error(updErr.message);

    const signed = await createSignedUploadUrl(supabase, storagePath);

    return res.status(201).json({
      version_id: versionRow.id,
      signed_upload_url: signed.signedUrl,
      storage_path: storagePath,
    });
  } catch (e) {
    console.error("[versions/create]", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
