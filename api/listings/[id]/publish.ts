import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { decryptSecret } from "../../../lib/clients-crypto.js";
import { renderWalkthroughHtml } from "../../../lib/walkthrough-template.js";
import { publishToSierra } from "../../../lib/sierra-publish.js";
import type { ScrapedListing } from "../../../lib/sierra-scrape.js";

export const config = {
  // Browser automation can take ~60s.
  maxDuration: 300,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();

  // Load landing page + client.
  const { data: lp, error: lpErr } = await supabase
    .from("landing_pages")
    .select("*")
    .eq("id", id)
    .eq("created_by", auth.user.id)
    .single();
  if (lpErr || !lp) return res.status(404).json({ error: "Listing not found" });

  if (lp.status === "published") {
    return res.status(409).json({ error: "Already published", listing: lp });
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("*")
    .eq("id", lp.client_id)
    .single();
  if (clientErr || !client) return res.status(404).json({ error: "Client not found" });

  // Mark publishing.
  await supabase
    .from("landing_pages")
    .update({ status: "publishing", publish_error: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  // Render the HTML.
  const listing = lp.scraped_data as ScrapedListing;
  const html = renderWalkthroughHtml({
    listing,
    videoUrl: lp.video_url,
    agent: {
      name: client.agent_name,
      team: client.agent_team,
      phone: client.agent_phone,
      email: client.agent_email,
      photoUrl: client.agent_photo_url,
      scheduleUrl: client.agent_schedule_url,
    },
    brandColor: client.brand_color_primary,
    sierraBaseUrl: client.sierra_public_base_url,
  });

  // Decrypt creds and run Apify.
  let password: string;
  try {
    password = decryptSecret(client.sierra_admin_password_encrypted);
  } catch (err) {
    await supabase
      .from("landing_pages")
      .update({
        status: "failed",
        publish_error: "Failed to decrypt Sierra credentials",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return res.status(500).json({ error: "Credential decryption failed" });
  }

  let result;
  try {
    result = await publishToSierra({
      sierraAdminUrl: client.sierra_admin_url,
      sierraSiteName: client.sierra_site_name || "",
      sierraAdminUsername: client.sierra_admin_username,
      sierraAdminPassword: password,
      sierraPublicBaseUrl: client.sierra_public_base_url,
      sierraSection: client.sierra_section || "Featured",
      pageSlug: lp.slug,
      pageTitle: `${listing.address} — Walkthrough`,
      pageHtml: html,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[publish] publishToSierra threw:", message, "\n", stack);
    await supabase
      .from("landing_pages")
      .update({
        status: "failed",
        publish_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return res.status(502).json({ error: message });
  }

  if (!result.ok) {
    await supabase
      .from("landing_pages")
      .update({
        status: "failed",
        publish_error: result.error || "Unknown publish error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return res.status(502).json({
      error: result.error,
      session_url: result.session_url,
    });
  }

  // Generate QR via api.qrserver.com (free, public).
  const qr_url = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(result.sierra_page_url || "")}`;

  const { data: updated, error: updateErr } = await supabase
    .from("landing_pages")
    .update({
      status: "published",
      sierra_page_url: result.sierra_page_url,
      qr_url,
      published_at: new Date().toISOString(),
      publish_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.json({
    ok: true,
    listing: updated,
    sierra_page_url: result.sierra_page_url,
    qr_url,
    session_url: result.session_url,
  });
}
