// api/blog/images/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { uploadImageBuffer } from "../../../lib/blog-engine/image-storage.js";
import { tagImage } from "../../../lib/blog-engine/image-tagging.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";

export const config = { api: { bodyParser: false } };

let _gemini: GoogleGenAI | null = null;
function gemini() {
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return _gemini;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const tag = req.query.tag as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const limit = Math.min(Number(req.query.limit ?? 200), 500);

    let qb = supabase.from("blog_images").select("*").eq("active", true)
      .order("created_at", { ascending: false }).limit(limit);
    if (tag) qb = qb.contains("vision_tags", [tag]);
    if (q) qb = qb.ilike("vision_caption", `%${q}%`);

    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ images: data ?? [] });
  }

  if (req.method === "POST") {
    return parseAndUpload(req, res, supabase);
  }

  return res.status(405).end();
}

async function parseAndUpload(req: VercelRequest, res: VercelResponse, supabase: any) {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
  let fileBuffer: Buffer | null = null;
  let originalFilename = "image.jpg";
  let folderHint: string | undefined;

  await new Promise<void>((resolve, reject) => {
    bb.on("file", (_name, stream, info) => {
      originalFilename = info.filename || originalFilename;
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => { fileBuffer = Buffer.concat(chunks); });
      stream.on("limit", () => reject(new Error("file > 10MB")));
    });
    bb.on("field", (name, val) => { if (name === "folder_hint") folderHint = val; });
    bb.on("close", () => resolve());
    bb.on("error", reject);
    req.pipe(bb);
  });

  if (!fileBuffer) return res.status(400).json({ error: "file required" });

  const hash = createHash("sha256").update(fileBuffer).digest("hex");
  const { data: existing } = await supabase
    .from("blog_images").select("*").eq("file_hash", hash).maybeSingle();
  if (existing) return res.status(200).json({ image: existing, deduped: true });

  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  const ext = extname(originalFilename).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  const upload = await uploadImageBuffer(supabase, {
    buffer: fileBuffer, siteId: site.id, fileHash: hash, mime, filenameExt: ext,
  });

  const { data: imgRow, error: iErr } = await supabase.from("blog_images").insert([{
    site_id: site.id,
    blob_url: upload.blob_url, mime: upload.mime,
    width: upload.width, height: upload.height,
    file_hash: hash,
    metadata: { folder_hint: folderHint ?? null, original_filename: originalFilename },
  }]).select("*").single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  // Inline vision tag.
  try {
    const tagged = await tagImage(
      { buffer: fileBuffer, filename: originalFilename, folderHint },
      {
        vision: async ({ prompt, imageBase64, mime }) => {
          const r = await gemini().models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ inlineData: { data: imageBase64, mimeType: mime } }, { text: prompt }] }],
            config: { responseMimeType: "application/json", temperature: 0.1 },
          });
          return { text: (r as any).text ?? "" };
        },
        embed: async (text: string) => {
          const r = await gemini().models.embedContent({
            model: "gemini-embedding-2",
            contents: [{ parts: [{ text }] }],
            config: { outputDimensionality: 768 },
          });
          const v = (r as any)?.embeddings?.[0]?.values ?? (r as any)?.embedding?.values;
          if (!v || v.length !== 768) throw new Error("embed bad shape");
          return v;
        },
      },
    );
    await supabase.from("blog_images").update({
      vision_tags: tagged.tags, vision_caption: tagged.caption, embedding: tagged.embedding,
    }).eq("id", imgRow.id);
    await recordBlogCost(supabase, {
      stage: "blog_image_tag", cost_cents: tagged.costCents,
      post_id: null, site_id: site.id, provider: "gemini",
      metadata: { image_id: imgRow.id, vision_tags: tagged.tags, inline: true },
    });

    return res.status(201).json({
      image: { ...imgRow, vision_tags: tagged.tags, vision_caption: tagged.caption },
    });
  } catch (e: any) {
    // Tagging failed — image is still uploaded + row exists. Surface to client.
    return res.status(201).json({
      image: imgRow,
      tagging_error: e?.message ?? String(e),
    });
  }
}
