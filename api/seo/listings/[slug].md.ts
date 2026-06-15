import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../lib/client.js";
import { fetchPublicListingSeoArtifactBySlug } from "../../../lib/seo/repository.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug ?? "");
  const artifact = await fetchPublicListingSeoArtifactBySlug(getSupabase(), slug);
  if (!artifact) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  return res.status(200).send(artifact.llms_markdown);
}
