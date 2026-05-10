// lib/blog-engine/jobs/handlers/image-match.ts
import { GoogleGenAI } from "@google/genai";
import type { JobHandler } from "../runner";

let _gemini: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return _gemini;
}

const RECENT_USAGE_DAYS = 14;

export const imageMatchHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error("image_match job requires post_id");

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("*").eq("id", job.post_id).single();
  if (pErr || !post) throw new Error(`image_match: post ${job.post_id} not found`);

  // Idempotency: already matched → just transition state and return.
  if (post.image_id) {
    if (post.state === "draft_ready") {
      await supabase.from("blog_posts").update({ state: "awaiting_approval" }).eq("id", post.id);
    }
    return { result: { skipped: "already_matched", image_id: post.image_id } };
  }

  // Strip HTML, build query text.
  const queryText = (post.title + "\n" + (post.body_html ?? "").slice(0, 1000))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!queryText) throw new Error(`image_match: post ${post.id} has no title/body to embed`);

  // Embed the query text.
  const embedResp = await gemini().models.embedContent({
    model: "gemini-embedding-2",
    contents: [{ parts: [{ text: queryText }] }],
    config: { outputDimensionality: 768 },
  });
  const queryEmbedding =
    (embedResp as any)?.embeddings?.[0]?.values ??
    (embedResp as any)?.embedding?.values ??
    null;
  if (!queryEmbedding || queryEmbedding.length !== 768) {
    throw new Error(`image_match: empty or wrong-dim query embedding`);
  }

  // First pass: with recent-usage soft-block.
  const { data: candidates, error: cErr } = await supabase.rpc("blog_match_image", {
    q_embedding: queryEmbedding,
    q_site_id: post.site_id,
    recent_days: RECENT_USAGE_DAYS,
    n_limit: 1,
  });
  if (cErr) throw new Error(`image_match: rpc failed: ${cErr.message}`);

  let imageId = (candidates as { id: string }[] | null)?.[0]?.id;

  // Fallback: if soft-block excluded everything, retry without it.
  if (!imageId) {
    const { data: fallback, error: fErr } = await supabase.rpc("blog_match_image", {
      q_embedding: queryEmbedding,
      q_site_id: post.site_id,
      recent_days: 0,
      n_limit: 1,
    });
    if (fErr) throw new Error(`image_match: fallback rpc failed: ${fErr.message}`);
    imageId = (fallback as { id: string }[] | null)?.[0]?.id;
  }
  if (!imageId) throw new Error("image_match: no candidate images in library");

  await supabase.from("blog_posts").update({
    image_id: imageId,
    state: "awaiting_approval",
    updated_at: new Date().toISOString(),
  }).eq("id", post.id);

  await supabase.from("blog_image_usages").insert([{ post_id: post.id, image_id: imageId }]);

  return { result: { image_id: imageId } };
};
