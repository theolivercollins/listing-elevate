// api/admin/music/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export const config = { api: { bodyParser: false } };

const ALLOWED_MOOD_TAGS = ["upbeat", "warm", "celebratory", "cinematic", "neutral"] as const;
type MoodTag = (typeof ALLOWED_MOOD_TAGS)[number];

const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave"]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function isMoodTag(v: unknown): v is MoodTag {
  return typeof v === "string" && (ALLOWED_MOOD_TAGS as readonly string[]).includes(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("music_tracks")
      .select("*")
      .order("mood_tag", { ascending: true })
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tracks: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Failed to list music tracks", detail: msg });
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES } });

  let fileBuffer: Buffer | null = null;
  let fileMime = "audio/mpeg";
  let fileExt = ".mp3";
  let oversized = false;

  const fields: Record<string, string> = {};

  await new Promise<void>((resolve, reject) => {
    bb.on("file", (_fieldname, stream, info) => {
      fileMime = info.mimeType || "audio/mpeg";
      const rawExt = extname(info.filename || "track.mp3").toLowerCase();
      fileExt = rawExt || ".mp3";

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        if (!oversized) fileBuffer = Buffer.concat(chunks);
      });
      stream.on("limit", () => {
        oversized = true;
        stream.resume(); // drain to allow busboy to close
      });
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("close", () => resolve());
    bb.on("error", reject);
    req.pipe(bb);
  });

  if (oversized) {
    return res.status(413).json({ error: "File too large (max 20 MB)" });
  }

  if (!fileBuffer) {
    return res.status(400).json({ error: "file required" });
  }

  if (!ALLOWED_MIME.has(fileMime)) {
    return res.status(415).json({ error: "Unsupported media type — upload mp3, m4a or wav" });
  }

  const { name, mood_tag, license, attribution } = fields;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  if (!isMoodTag(mood_tag)) {
    return res.status(400).json({
      error: `mood_tag must be one of: ${ALLOWED_MOOD_TAGS.join(", ")}`,
    });
  }

  const supabase = getSupabase();
  const trackId = randomUUID();
  const storagePath = `${trackId}${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("music")
    .upload(storagePath, fileBuffer, { contentType: fileMime, upsert: false });

  if (uploadError) {
    return res.status(500).json({ error: "Storage upload failed", detail: uploadError.message });
  }

  const { data: urlData } = supabase.storage.from("music").getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  const { data: track, error: insertError } = await supabase
    .from("music_tracks")
    .insert({
      id: trackId,
      name: name.trim(),
      file_url: publicUrl,
      mood_tag,
      license: license?.trim() || null,
      attribution: attribution?.trim() || null,
      active: true,
    })
    .select("*")
    .single();

  if (insertError) {
    return res.status(500).json({ error: "DB insert failed", detail: insertError.message });
  }

  return res.status(200).json({ track });
}
