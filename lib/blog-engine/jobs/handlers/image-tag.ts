// lib/blog-engine/jobs/handlers/image-tag.ts
import { GoogleGenAI } from "@google/genai";
import type { JobHandler } from "../runner.js";
import { recordBlogCost } from "../../cost.js";
import { tagImage } from "../../image-tagging.js";

let _gemini: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!_gemini) {
    _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return _gemini;
}

export const imageTagHandler: JobHandler = async ({ supabase, job }) => {
  const imageId = (job.payload?.image_id as string | undefined);
  if (!imageId) throw new Error("image_tag job requires payload.image_id");

  const { data: img, error } = await supabase
    .from("blog_images").select("*").eq("id", imageId).single();
  if (error || !img) throw new Error(`image_tag: image ${imageId} not found`);

  // Idempotency: already tagged → no-op.
  if (img.embedding && Array.isArray(img.vision_tags) && img.vision_tags.length > 0) {
    return { result: { skipped: "already_tagged" } };
  }

  // Pull image bytes from Supabase Storage public URL.
  const res = await fetch(img.blob_url);
  if (!res.ok) throw new Error(`image_tag: fetch ${img.blob_url} failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const folderHint = (img.metadata as Record<string, unknown> | null)?.folder_hint as string | undefined;

  const result = await tagImage(
    {
      buffer,
      filename: `${img.file_hash}${img.mime === "image/png" ? ".png" : ".jpg"}`,
      folderHint,
    },
    {
      vision: async ({ prompt, imageBase64, mime }) => {
        const resp = await gemini().models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { data: imageBase64, mimeType: mime } },
                { text: prompt },
              ],
            },
          ],
          config: { responseMimeType: "application/json", temperature: 0.1 },
        });
        return { text: (resp as any).text ?? "" };
      },
      embed: async (text: string) => {
        const resp = await gemini().models.embedContent({
          model: "gemini-embedding-2",
          contents: [{ parts: [{ text }] }],
          config: { outputDimensionality: 768 },
        });
        const v =
          (resp as any)?.embeddings?.[0]?.values ??
          (resp as any)?.embedding?.values ??
          null;
        if (!v || v.length !== 768) {
          throw new Error(`image_tag: embed returned bad shape (len=${v?.length ?? "null"})`);
        }
        return v;
      },
    },
  );

  await supabase.from("blog_images").update({
    vision_tags: result.tags,
    vision_caption: result.caption,
    embedding: result.embedding,
  }).eq("id", imageId);

  await recordBlogCost(supabase, {
    stage: "blog_image_tag",
    cost_cents: result.costCents,
    post_id: null,
    site_id: img.site_id ?? "",
    provider: "gemini",
    metadata: { image_id: imageId, vision_tags: result.tags },
  });

  return { result: { tags: result.tags, caption: result.caption.slice(0, 80) } };
};
