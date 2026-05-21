// api/blog/emails/[id]/test.ts
//
// Send a Sendy test campaign to a designated test list. Sendy doesn't have a
// "send to one address" primitive — the canonical pattern is to keep a small
// "Tests" list in Sendy (one or two admin addresses) and fire the campaign at
// it with a [TEST] subject prefix.
//
// Body shape:
//   { list_id?: string }    // override the env-default test list
// Does NOT mutate the email row's state. Cost is still recorded.
//
// Required env vars:
//   SENDY_URL                  — base URL of the Sendy install
//   SENDY_API_KEY              — API key
//   SENDY_BRAND_ID             — brand ID
//   SENDY_TEST_LIST_ID         — default list ID to send tests to
//   DEFAULT_EMAIL_FROM_NAME    — fallback from name
//   DEFAULT_EMAIL_FROM_EMAIL   — fallback from email
//   DEFAULT_EMAIL_REPLY_TO     — fallback reply-to (optional)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";
import { recordBlogCost } from "../../../../lib/blog-engine/cost.js";

async function sendyCreateCampaign(params: {
  sendyUrl: string;
  apiKey: string;
  brandId: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  subject: string;
  htmlBody: string;
  plainText?: string;
  listIds: string[];
  title?: string;
}): Promise<{ ok: boolean; message: string; campaignUrl: string | null }> {
  const form = new URLSearchParams();
  form.set("api_key", params.apiKey);
  form.set("from_name", params.fromName);
  form.set("from_email", params.fromEmail);
  form.set("reply_to", params.replyTo || params.fromEmail);
  form.set("title", params.title ?? params.subject);
  form.set("subject", params.subject);
  form.set("html_text", params.htmlBody);
  if (params.plainText) form.set("plain_text", params.plainText);
  form.set("brand_id", params.brandId);
  form.set("send_campaign", "1");
  form.set("list_ids", params.listIds.join(","));

  let resp: Response;
  try {
    resp = await fetch(`${params.sendyUrl.replace(/\/$/, "")}/api/campaigns/create.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : String(err)}`, campaignUrl: null };
  }

  const text = (await resp.text()).trim();
  const lower = text.toLowerCase();
  const looksLikeUrl = /^https?:\/\//.test(text);
  const ok =
    looksLikeUrl ||
    lower.includes("campaign created") ||
    lower.includes("now sending") ||
    lower.includes("queued");
  return {
    ok,
    message: text || "(empty response from Sendy)",
    campaignUrl: looksLikeUrl ? text : null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const body = (req.body ?? {}) as { list_id?: unknown };
  const overrideListId = typeof body.list_id === "string" && body.list_id.trim()
    ? body.list_id.trim()
    : null;
  const testListId = overrideListId ?? process.env.SENDY_TEST_LIST_ID;
  if (!testListId) {
    return res.status(400).json({
      error: "test list not configured — pass { list_id } in body or set SENDY_TEST_LIST_ID env var",
    });
  }

  const supabase = getSupabase();

  const { data: row, error: rowErr } = await supabase
    .from("emails").select("*").eq("id", id).single();
  if (rowErr || !row) return res.status(404).json({ error: "email not found" });

  const sendyUrl = process.env.SENDY_URL;
  const apiKey = process.env.SENDY_API_KEY;
  const brandId = process.env.SENDY_BRAND_ID;
  if (!sendyUrl || !apiKey || !brandId) {
    return res.status(500).json({
      error: "Sendy not configured — set SENDY_URL, SENDY_API_KEY, SENDY_BRAND_ID env vars",
    });
  }

  const fromName = row.from_name ?? process.env.DEFAULT_EMAIL_FROM_NAME ?? "";
  const fromEmail = row.from_email ?? process.env.DEFAULT_EMAIL_FROM_EMAIL ?? "";
  const replyTo = row.reply_to ?? process.env.DEFAULT_EMAIL_REPLY_TO ?? fromEmail;
  if (!fromEmail) {
    return res.status(400).json({
      error: "from_email required — set on the email row or via DEFAULT_EMAIL_FROM_EMAIL",
    });
  }
  if (!fromName) {
    return res.status(400).json({
      error: "from_name required — set on the email row or via DEFAULT_EMAIL_FROM_NAME",
    });
  }

  const subject = `[TEST] ${row.subject || "(no subject)"}`;

  const costCents = Math.ceil(1 * 0.04);
  try {
    await recordBlogCost(supabase, {
      stage: "blog_email_send",
      cost_cents: costCents,
      post_id: row.source_post_id ?? null,
      site_id: row.site_id,
      provider: "sendy",
      metadata: { email_id: id, test: true, test_list_id: testListId },
    });
  } catch (costErr) {
    console.error("[test-send] cost record failed:", costErr);
  }

  const result = await sendyCreateCampaign({
    sendyUrl, apiKey, brandId,
    fromName, fromEmail, replyTo,
    subject,
    htmlBody: row.body_html,
    plainText: row.body_text ?? undefined,
    listIds: [testListId],
    title: subject,
  });

  if (!result.ok) {
    return res.status(502).json({ error: `Sendy test send failed: ${result.message}` });
  }

  return res.status(200).json({
    ok: true,
    message_id: result.campaignUrl,
    sent_to_list_id: testListId,
    subject,
    sendy_response: result.message,
  });
}
