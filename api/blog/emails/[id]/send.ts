// api/blog/emails/[id]/send.ts
//
// Send an email via Resend. Recipients come from the request body `{ to: string[] }`
// (override) or the row's recipients_json if no body override is given.
//
// Required env vars:
//   RESEND_API_KEY              — Resend API key (required at send time)
//   DEFAULT_EMAIL_FROM_NAME     — fallback from name if row.from_name is null (optional)
//   DEFAULT_EMAIL_FROM_EMAIL    — fallback from email if row.from_email is null (optional)
//
// State machine:
//   draft / ready → sending → sent (on success)
//                           → failed (on provider error)
//   already sent  → 409 Conflict
//
// Cost: 0.04 cents per recipient, stage='blog_email_send', provider='resend'.
// Cost is ALWAYS recorded, even on failure (we attempted the send).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";
import { recordBlogCost } from "../../../../lib/blog-engine/cost.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmails(addrs: unknown): string[] | null {
  if (!Array.isArray(addrs) || addrs.length === 0) return null;
  for (const a of addrs) {
    if (typeof a !== "string" || !EMAIL_RE.test(a)) return null;
  }
  return addrs as string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();

  // Fetch the email row
  const { data: row, error: rowErr } = await supabase
    .from("emails")
    .select("*")
    .eq("id", id)
    .single();
  if (rowErr || !row) return res.status(404).json({ error: "email not found" });

  // Guard: already sent
  if (row.state === "sent") {
    return res.status(409).json({ error: "email already sent", sent_at: row.sent_at });
  }

  // Resolve recipients: body override takes priority, then row's recipients_json
  const bodyTo = (req.body ?? {}).to as unknown;
  const rawRecipients: unknown = bodyTo !== undefined ? bodyTo : row.recipients_json;
  const recipients = validateEmails(rawRecipients);
  if (!recipients) {
    return res.status(400).json({
      error: "recipients must be a non-empty array of valid email addresses. " +
        "Pass { to: ['a@b.com'] } in the request body or set recipients_json on the email row.",
    });
  }

  // Resolve from address
  const fromName = row.from_name ?? process.env.DEFAULT_EMAIL_FROM_NAME ?? "";
  const fromEmail = row.from_email ?? process.env.DEFAULT_EMAIL_FROM_EMAIL ?? "";
  if (!fromEmail) {
    return res.status(400).json({
      error: "from_email is required — set it on the email row or via DEFAULT_EMAIL_FROM_EMAIL env var",
    });
  }
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  // Validate subject
  if (!row.subject) {
    return res.status(400).json({ error: "email subject is empty — set subject before sending" });
  }

  // Mark as sending
  const { error: sendingErr } = await supabase
    .from("emails")
    .update({ state: "sending", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (sendingErr) return res.status(500).json({ error: `state transition failed: ${sendingErr.message}` });

  // Record cost before send attempt (we attempted regardless of outcome)
  const costCents = Math.ceil(recipients.length * 0.04);
  try {
    await recordBlogCost(supabase, {
      stage: "blog_email_send",
      cost_cents: costCents,
      post_id: row.source_post_id ?? null,
      site_id: row.site_id,
      provider: "resend",
      metadata: { email_id: id, recipient_count: recipients.length },
    });
  } catch (costErr) {
    // Cost errors are non-fatal for the send itself, but log them
    console.error("[send] cost record failed:", costErr);
  }

  // Attempt send via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  let messageId: string | null = null;
  let sendError: string | null = null;

  try {
    const sendResult = await resend.emails.send({
      from,
      to: recipients,
      subject: row.subject,
      html: row.body_html,
      ...(row.body_text ? { text: row.body_text } : {}),
      ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    });
    if (sendResult.error) {
      sendError = sendResult.error.message ?? "Resend returned an error";
    } else {
      messageId = sendResult.data?.id ?? null;
    }
  } catch (err: unknown) {
    sendError = err instanceof Error ? err.message : String(err);
  }

  // Update row based on outcome
  if (sendError) {
    await supabase
      .from("emails")
      .update({
        state: "failed",
        send_error: sendError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return res.status(502).json({ error: `send failed: ${sendError}` });
  }

  await supabase
    .from("emails")
    .update({
      state: "sent",
      send_provider: "resend",
      send_provider_message_id: messageId,
      sent_to: recipients,
      sent_at: new Date().toISOString(),
      cost_usd_cents: costCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return res.status(200).json({
    ok: true,
    message_id: messageId,
    sent_to: recipients,
  });
}
