// api/blog/emails/[id]/test.ts
//
// Send a one-off test email to a single address. Does NOT mutate email state.
// Subject is prefixed with "[TEST] ". Cost is recorded the same as a live send.
//
// Required env vars:
//   RESEND_API_KEY              — Resend API key
//   DEFAULT_EMAIL_FROM_NAME     — fallback from name (optional)
//   DEFAULT_EMAIL_FROM_EMAIL    — fallback from email (optional)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";
import { recordBlogCost } from "../../../../lib/blog-engine/cost.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const body = (req.body ?? {}) as { to?: unknown };
  const to = body.to;
  if (typeof to !== "string" || !EMAIL_RE.test(to)) {
    return res.status(400).json({
      error: "body.to must be a valid email address (single address for test send)",
    });
  }

  const supabase = getSupabase();

  const { data: row, error: rowErr } = await supabase
    .from("emails")
    .select("*")
    .eq("id", id)
    .single();
  if (rowErr || !row) return res.status(404).json({ error: "email not found" });

  // Resolve from address
  const fromName = row.from_name ?? process.env.DEFAULT_EMAIL_FROM_NAME ?? "";
  const fromEmail = row.from_email ?? process.env.DEFAULT_EMAIL_FROM_EMAIL ?? "";
  if (!fromEmail) {
    return res.status(400).json({
      error: "from_email is required — set it on the email row or via DEFAULT_EMAIL_FROM_EMAIL env var",
    });
  }
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  const subject = `[TEST] ${row.subject || "(no subject)"}`;

  // Record cost (1 recipient)
  const costCents = Math.ceil(1 * 0.04);
  try {
    await recordBlogCost(supabase, {
      stage: "blog_email_send",
      cost_cents: costCents,
      post_id: row.source_post_id ?? null,
      site_id: row.site_id,
      provider: "resend",
      metadata: { email_id: id, test: true, test_recipient: to },
    });
  } catch (costErr) {
    console.error("[test-send] cost record failed:", costErr);
  }

  // Send via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  let messageId: string | null = null;
  let sendError: string | null = null;

  try {
    const sendResult = await resend.emails.send({
      from,
      to: [to],
      subject,
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

  if (sendError) {
    return res.status(502).json({ error: `test send failed: ${sendError}` });
  }

  return res.status(200).json({
    ok: true,
    message_id: messageId,
    sent_to: to,
    subject,
  });
}
