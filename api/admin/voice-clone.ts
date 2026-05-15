// api/admin/voice-clone.ts — Staff-driven voice clone enrollment.
// All endpoints are admin-only. Customers cannot self-enroll: the team
// reaches out to schedule a 15-minute recording session, then an admin
// uploads the captured sample on behalf of the user via this endpoint.
//
// POST   /api/admin/voice-clone — upload sample for a target user, run IVC
// GET    /api/admin/voice-clone?user_id=… — status check for a user
// PATCH  /api/admin/voice-clone — flip status without uploading (e.g. mark 'scheduled')
// DELETE /api/admin/voice-clone?user_id=… — reset (testing / re-record)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { extname } from "node:path";
import { requireAdmin } from "../../lib/auth.js";
import {
  getSupabase,
  setUserVoiceClone,
  recordCostEvent,
} from "../../lib/db.js";
import { ElevenLabsProvider } from "../../lib/providers/elevenlabs.js";

export const config = { api: { bodyParser: false } };

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/mp4",
  "audio/webm",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Statuses an admin can set without uploading a sample. Mirrors the
// CHECK constraint on user_profiles.voice_clone_status (migration 056).
const SETTABLE_STATUSES = new Set([
  "none",
  "requested",
  "scheduled",
  "recording",
  "ready",
  "failed",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

// Resolve target_user_id from body (POST) or query (GET/DELETE/PATCH).
// Admin acts on behalf of a customer; we never default to the admin's own id.
function resolveTargetUserId(req: VercelRequest): string | null {
  const fromQuery = (req.query.user_id ?? req.query.target_user_id) as string | undefined;
  const body = (req.body ?? {}) as { user_id?: string; target_user_id?: string };
  return fromQuery || body.user_id || body.target_user_id || null;
}

// ── POST — upload sample, run IVC ──────────────────────────────────────────────

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  // Parse multipart upload. target_user_id arrives as a regular form field
  // alongside the audio file; we collect it inside the busboy `field` handler.
  let fileBuffer: Buffer | null = null;
  let fileMime = "";
  let fileExt = ".mp3";
  let fileCount = 0;
  let oversized = false;
  let targetUserId = "";
  let cloneNameOverride: string | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_FILE_BYTES, files: 2 },
      });

      bb.on("field", (name, value) => {
        if (name === "user_id" || name === "target_user_id") targetUserId = value;
        if (name === "name") cloneNameOverride = value;
      });

      bb.on("file", (_field, stream, info) => {
        fileCount++;
        fileMime = info.mimeType || "";
        const rawExt = extname(info.filename || "sample.mp3").toLowerCase() || ".mp3";
        fileExt = rawExt;

        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("limit", () => { oversized = true; });
        stream.on("end", () => {
          if (!oversized && fileCount === 1) {
            fileBuffer = Buffer.concat(chunks);
          }
        });
      });

      bb.on("close", () => resolve());
      bb.on("error", reject);
      req.pipe(bb);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: `Multipart parse error: ${msg}` });
  }

  if (!targetUserId) {
    return res.status(400).json({
      error: "Missing target_user_id — staff must specify which customer is being enrolled",
    });
  }
  if (oversized) return res.status(413).json({ error: "File too large — max 10 MB" });
  if (fileCount === 0 || !fileBuffer) {
    return res.status(400).json({ error: "No file provided — send field name 'sample'" });
  }
  if (fileCount > 1) return res.status(400).json({ error: "Only one sample file allowed" });
  if (!ALLOWED_MIME_TYPES.has(fileMime)) {
    return res.status(415).json({
      error: `Unsupported media type '${fileMime}'. Accepted: audio/mpeg, audio/mp3, audio/wav, audio/x-wav, audio/m4a, audio/mp4, audio/webm`,
    });
  }

  // Look up the target user's profile so we can name the clone humanely.
  const { data: targetProfile, error: profileErr } = await getSupabase()
    .from("user_profiles")
    .select("first_name, last_name, email")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (profileErr) {
    return res.status(500).json({ error: `Profile lookup failed: ${profileErr.message}` });
  }
  if (!targetProfile) {
    return res.status(404).json({ error: `No user_profiles row for user_id=${targetUserId}` });
  }

  // Eager status flip so a partial failure surfaces a state.
  await setUserVoiceClone(targetUserId, { status: "enrolling" });

  const storagePath = `${targetUserId}/clone-sample${fileExt}`;

  try {
    const supabase = getSupabase();
    const { error: uploadErr } = await supabase.storage
      .from("voiceovers")
      .upload(storagePath, fileBuffer, { contentType: fileMime, upsert: true });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage.from("voiceovers").getPublicUrl(storagePath);
    const sampleUrl = urlData?.publicUrl ?? storagePath;

    const cloneName =
      cloneNameOverride?.trim() ||
      `${targetProfile.first_name ?? "User"} ${targetProfile.last_name ?? ""}`.trim() ||
      targetProfile.email ||
      "Listing Elevate User";

    const provider = new ElevenLabsProvider();
    const result = await provider.cloneVoice({
      name: cloneName,
      description: "Listing Elevate voice clone",
      samples: [{ filename: "sample.mp3", mimeType: fileMime, data: fileBuffer }],
    });

    // IVC API call itself is $0 to us — the $125 customer fee is a separate
    // billing line (charged via Stripe Checkout when the staff team confirms
    // the recording session is scheduled). This row exists for cost telemetry.
    await recordCostEvent({
      propertyId: null,
      stage: "voiceover",
      provider: "elevenlabs",
      costCents: 0,
      unitType: null,
      metadata: {
        scope: "voice_clone_create",
        user_id: targetUserId,
        voice_id: result.voiceId,
        admin_user_id: auth.user.id,
      },
    });

    // Mark ready. paid_cents is set here optimistically; once Stripe is wired
    // for the $125 line, the webhook will set it instead.
    await setUserVoiceClone(targetUserId, {
      voice_id: result.voiceId,
      status: "ready",
      sample_url: sampleUrl,
      paid_cents: 12500,
    });

    return res.status(200).json({
      voice_id: result.voiceId,
      status: "ready",
      paid_cents: 12500,
      user_id: targetUserId,
    });
  } catch (err) {
    try {
      await setUserVoiceClone(targetUserId, { status: "failed" });
    } catch { /* ignore secondary error */ }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[voice-clone POST] error:", msg, err);
    return res.status(500).json({ error: msg });
  }
}

// ── GET — status for a target user ─────────────────────────────────────────────

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const targetUserId = resolveTargetUserId(req);
  if (!targetUserId) return res.status(400).json({ error: "Missing user_id query param" });

  try {
    const { data, error } = await getSupabase()
      .from("user_profiles")
      .select(
        "elevenlabs_voice_id, voice_clone_status, voice_clone_paid_cents, voice_clone_paid_at, voice_clone_created_at"
      )
      .eq("user_id", targetUserId)
      .single();

    if (error) throw error;

    return res.status(200).json({
      status: data.voice_clone_status ?? "none",
      voice_id: data.elevenlabs_voice_id ?? null,
      paid_cents: data.voice_clone_paid_cents ?? null,
      paid_at: data.voice_clone_paid_at ?? null,
      created_at: data.voice_clone_created_at ?? null,
      user_id: targetUserId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}

// ── PATCH — update status without uploading (e.g. 'scheduled') ─────────────────

async function handlePatch(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const targetUserId = resolveTargetUserId(req);
  if (!targetUserId) return res.status(400).json({ error: "Missing user_id" });

  const body = (req.body ?? {}) as { status?: string };
  if (!body.status || !SETTABLE_STATUSES.has(body.status)) {
    return res.status(400).json({
      error: `Invalid status. Allowed: ${[...SETTABLE_STATUSES].join(", ")}`,
    });
  }

  try {
    await setUserVoiceClone(targetUserId, { status: body.status });
    return res.status(200).json({ status: body.status, user_id: targetUserId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}

// ── DELETE — reset for re-recording ────────────────────────────────────────────

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const targetUserId = resolveTargetUserId(req);
  if (!targetUserId) return res.status(400).json({ error: "Missing user_id" });

  try {
    await setUserVoiceClone(targetUserId, {
      status: "none",
      voice_id: undefined,
      sample_url: undefined,
      paid_cents: undefined,
    });

    await getSupabase()
      .from("user_profiles")
      .update({
        elevenlabs_voice_id: null,
        voice_clone_sample_url: null,
        voice_clone_paid_cents: null,
        voice_clone_paid_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", targetUserId);

    return res.status(200).json({ status: "none", user_id: targetUserId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
