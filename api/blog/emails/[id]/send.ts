// api/blog/emails/[id]/send.ts
//
// Send a campaign via Sendy (self-hosted, Amazon-SES-backed bulk mailer).
//
// Sendy speaks form-urlencoded → plain-text responses (NOT JSON). On the
// happy path it returns either "Campaign created" (draft saved) or a string
// containing "now sending" / "queued" (campaign queued for send). Anything
// else is an error message we surface verbatim.
//
// `recipients_json` on the email row stores Sendy list IDs (string-typed —
// Sendy accepts both numeric IDs and the new alphanumeric IDs). The request
// body may override with { list_ids: string[] }.
//
// Required env vars:
//   SENDY_URL                 — base URL of the Sendy install, no trailing slash
//   SENDY_API_KEY             — API key from Sendy "Settings" page
//   SENDY_BRAND_ID            — brand ID (a Sendy install can host multiple brands)
//   DEFAULT_EMAIL_FROM_NAME   — fallback from name when row.from_name is null
//   DEFAULT_EMAIL_FROM_EMAIL  — fallback from email when row.from_email is null
//   DEFAULT_EMAIL_REPLY_TO    — fallback reply-to (optional)
//
// State machine:
//   draft / ready → sending → sent (on success)
//                           → failed (on Sendy error)
//   already sent  → 409 Conflict
//
// Cost: 0.04 cents per Sendy list (we don't know the recipient count without
// an extra API hit; the underlying SES cost is ~$0.10/1k = 0.01¢/email). The
// cent figure is an internal accounting line, reconciled monthly against the
// AWS SES + Sendy invoice. stage='blog_email_send', provider='sendy'.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";
import { recordBlogCost } from "../../../../lib/blog-engine/cost.js";

function validateListIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim()) return null;
    out.push(v.trim());
  }
  return out;
}

interface SendyResult {
  ok: boolean;
  message: string;
  campaignUrl: string | null;
}

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
  sendImmediately: boolean;
  title?: string;
}): Promise<SendyResult> {
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
  form.set("send_campaign", params.sendImmediately ? "1" : "0");
  if (params.sendImmediately) {
    form.set("list_ids", params.listIds.join(","));
  }

  let resp: Response;
  try {
    resp = await fetch(`${params.sendyUrl.replace(/\/$/, "")}/api/campaigns/create.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, message: `network error contacting Sendy: ${err instanceof Error ? err.message : String(err)}`, campaignUrl: null };
  }

  const text = (await resp.text()).trim();

  // Happy paths Sendy returns (varies by version):
  //   "Campaign created"
  //   "Campaign created and now sending"
  //   "https://.../campaign?id=..."
  // Anything else = error string. HTTP status is usually 200 even on errors.
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

  const supabase = getSupabase();

  const { data: row, error: rowErr } = await supabase
    .from("emails").select("*").eq("id", id).single();
  if (rowErr || !row) return res.status(404).json({ error: "email not found" });

  if (row.state === "sent") {
    return res.status(409).json({ error: "email already sent", sent_at: row.sent_at });
  }

  // Resolve list IDs: body override takes priority, then row's recipients_json.
  const bodyLists = (req.body ?? {}).list_ids as unknown;
  const rawListIds: unknown = bodyLists !== undefined ? bodyLists : row.recipients_json;
  const listIds = validateListIds(rawListIds);
  if (!listIds) {
    return res.status(400).json({
      error: "list_ids must be a non-empty array of Sendy list IDs. " +
        "Pass { list_ids: ['abc123'] } in the body or set recipients_json on the email row.",
    });
  }

  // Resolve env config
  const sendyUrl = process.env.SENDY_URL;
  const apiKey = process.env.SENDY_API_KEY;
  const brandId = process.env.SENDY_BRAND_ID;
  if (!sendyUrl || !apiKey || !brandId) {
    return res.status(500).json({
      error: "Sendy not configured — set SENDY_URL, SENDY_API_KEY, SENDY_BRAND_ID env vars",
    });
  }

  // Resolve from address + reply-to
  const fromName = row.from_name ?? process.env.DEFAULT_EMAIL_FROM_NAME ?? "";
  const fromEmail = row.from_email ?? process.env.DEFAULT_EMAIL_FROM_EMAIL ?? "";
  const replyTo = row.reply_to ?? process.env.DEFAULT_EMAIL_REPLY_TO ?? fromEmail;
  if (!fromEmail) {
    return res.status(400).json({
      error: "from_email is required — set on the email row or via DEFAULT_EMAIL_FROM_EMAIL",
    });
  }
  if (!fromName) {
    return res.status(400).json({
      error: "from_name is required — set on the email row or via DEFAULT_EMAIL_FROM_NAME",
    });
  }

  if (!row.subject) {
    return res.status(400).json({ error: "email subject is empty — set subject before sending" });
  }

  // Mark as sending
  const { error: sendingErr } = await supabase
    .from("emails")
    .update({ state: "sending", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (sendingErr) return res.status(500).json({ error: `state transition failed: ${sendingErr.message}` });

  // Record cost — 0.04¢ per list (accounting-line; reconciled monthly vs SES invoice).
  const costCents = Math.ceil(listIds.length * 0.04);
  try {
    await recordBlogCost(supabase, {
      stage: "blog_email_send",
      cost_cents: costCents,
      post_id: row.source_post_id ?? null,
      site_id: row.site_id,
      provider: "sendy",
      metadata: { email_id: id, list_ids: listIds, list_count: listIds.length },
    });
  } catch (costErr) {
    console.error("[send] cost record failed:", costErr);
  }

  const result = await sendyCreateCampaign({
    sendyUrl, apiKey, brandId,
    fromName, fromEmail, replyTo,
    subject: row.subject,
    htmlBody: row.body_html,
    plainText: row.body_text ?? undefined,
    listIds,
    sendImmediately: true,
    title: row.subject,
  });

  if (!result.ok) {
    await supabase
      .from("emails")
      .update({
        state: "failed",
        send_error: result.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return res.status(502).json({ error: `Sendy send failed: ${result.message}` });
  }

  await supabase
    .from("emails")
    .update({
      state: "sent",
      send_provider: "sendy",
      send_provider_message_id: result.campaignUrl,
      sent_to: listIds,
      sent_at: new Date().toISOString(),
      cost_usd_cents: costCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return res.status(200).json({
    ok: true,
    message_id: result.campaignUrl,
    sent_to_list_ids: listIds,
    sendy_response: result.message,
  });
}
