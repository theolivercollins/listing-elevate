import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../lib/client.js";
import { fetchPublicListingSeoArtifactBySlug } from "../../../lib/seo/repository.js";
import type { ListingSeoArtifactRow } from "../../../lib/seo/types.js";

function toPublicListingDto(artifact: ListingSeoArtifactRow) {
  return {
    slug: artifact.slug,
    title: artifact.title,
    meta_description: artifact.meta_description,
    summary: artifact.summary,
    long_description: artifact.long_description,
    highlights: artifact.highlights,
    faqs: artifact.faqs,
    schema_json: artifact.schema_json,
    markdown_url: `/listings/${artifact.slug}.md`,
    canonical_path: `/listings/${artifact.slug}`,
    updated_at: artifact.updated_at,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug ?? "");
  const artifact = await fetchPublicListingSeoArtifactBySlug(getSupabase(), slug);
  if (!artifact) return res.status(404).json({ error: "not_found" });
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  return res.status(200).json({ listing: toPublicListingDto(artifact) });
}
