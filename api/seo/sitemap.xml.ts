import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../lib/client.js";
import { defaultSeoBaseUrl, listPublicListingSeoArtifacts } from "../../lib/seo/repository.js";
import { renderSitemapXml } from "../../lib/seo/render.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const baseUrl = defaultSeoBaseUrl();
  const rows = await listPublicListingSeoArtifacts(getSupabase());
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  return res.status(200).send(renderSitemapXml(rows, baseUrl));
}
