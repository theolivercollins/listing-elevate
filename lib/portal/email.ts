import { Resend } from "resend";

let cached: Resend | null = null;

function getResend(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // gracefully no-op in dev if not configured
  cached = new Resend(key);
  return cached;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Oliver Helgemo <oliver@recasi.com>";
}

export interface EmailArgs {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(args: EmailArgs): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[portal/email] RESEND_API_KEY missing — skipping send to", args.to);
    return;
  }
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: args.to,
    subject: args.subject,
    html: args.html,
    replyTo: args.replyTo,
  });
  if (error) {
    console.error("[portal/email] resend error", error);
    throw new Error(`Resend failed: ${error.message}`);
  }
}

// Editorial monochrome shell to match the LE design language.
export function emailShell(opts: { heading: string; body: string; cta?: { label: string; url: string } }): string {
  const cta = opts.cta
    ? `<a href="${opts.cta.url}" style="display:inline-block;padding:14px 28px;background:#171717;color:#fff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:500;letter-spacing:-0.01em;margin-top:24px;">${opts.cta.label} →</a>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:48px 24px;background:#fafafa;font-family:Inter,-apple-system,system-ui,sans-serif;color:#171717;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:48px;border:1px solid #e5e5e5;">
    <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#737373;margin:0 0 16px;">— Listing Elevate</p>
    <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0 0 24px;">${opts.heading}</h1>
    <div style="font-size:15px;line-height:1.6;color:#404040;">${opts.body}</div>
    ${cta}
    <p style="font-size:11px;color:#a3a3a3;margin-top:48px;border-top:1px solid #e5e5e5;padding-top:16px;">listingelevate.com</p>
  </div>
</body></html>`;
}

// ─── Templated emails (Phase 2) ───────────────────────────────────────────
// `onboarding_thanks` is intentionally omitted — the existing onboarding flow
// in api/portal/orders/index.ts uses its own pre-onboarding email, and there
// is no post-onboarding "we'll deliver shortly" copy to preserve. Owner-side
// notification is sufficient until product calls for a client thank-you.

export type EmailTemplate =
  | "deliverable_ready_v1"
  | "deliverable_ready_vn"
  | "comment_added"
  | "revision_requested"
  | "approval_received"
  | "payment_receipt"
  | "onboarding_completed_owner";

interface RenderedEmail {
  subject: string;
  html: string;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function renderTemplate(template: EmailTemplate, data: Record<string, unknown>): RenderedEmail {
  switch (template) {
    case "deliverable_ready_v1": {
      const orderTitle = str(data.order_title, "your video");
      const reviewUrl = str(data.review_url);
      return {
        subject: `Your video is ready to review — ${orderTitle}`,
        html: emailShell({
          heading: "Your video is ready",
          body: `<p>Open the review link below to watch, leave timestamped feedback, and approve when you're happy.</p>`,
          cta: { label: "Review your video", url: reviewUrl },
        }),
      };
    }
    case "deliverable_ready_vn": {
      const orderTitle = str(data.order_title, "your video");
      const reviewUrl = str(data.review_url);
      return {
        subject: `New version ready — ${orderTitle}`,
        html: emailShell({
          heading: "A new version is ready",
          body: `<p>Your latest revision is uploaded. Open the review link to compare and approve.</p>`,
          cta: { label: "Open review", url: reviewUrl },
        }),
      };
    }
    case "comment_added": {
      const author = str(data.author, "Someone");
      const note = str(data.body);
      const reviewUrl = str(data.review_url);
      const escaped = note.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return {
        subject: `New comment from ${author}`,
        html: emailShell({
          heading: "New comment",
          body: `<p><strong>${author}</strong> left a comment:</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:2px solid #171717;font-style:italic;color:#404040;">${escaped}</blockquote>`,
          cta: { label: "Open review", url: reviewUrl },
        }),
      };
    }
    case "revision_requested": {
      const author = str(data.author, "The client");
      const note = str(data.note);
      const reviewUrl = str(data.review_url);
      const escaped = note.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return {
        subject: `Revision requested by ${author}`,
        html: emailShell({
          heading: "Revision requested",
          body: `<p><strong>${author}</strong> requested a revision:</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:2px solid #171717;font-style:italic;color:#404040;">${escaped}</blockquote><p>Upload the new version when ready — the client will be emailed automatically.</p>`,
          cta: { label: "Open review", url: reviewUrl },
        }),
      };
    }
    case "approval_received": {
      const orderTitle = str(data.order_title, "the order");
      const amount = str(data.amount);
      const currency = str(data.currency, "USD");
      return {
        subject: `Approved & paid — ${orderTitle}`,
        html: emailShell({
          heading: "Approved & paid",
          body: `<p><strong>${orderTitle}</strong> just cleared.</p>${amount ? `<p>Amount: <strong>$${amount} ${currency}</strong></p>` : ""}`,
        }),
      };
    }
    case "onboarding_completed_owner": {
      const customerName = str(data.customer_name, "Your client");
      const orderTitle = str(data.order_title, "the order");
      const orderUrl = str(data.order_url);
      return {
        subject: `${customerName} confirmed details — ${orderTitle}`,
        html: emailShell({
          heading: "Customer onboarded",
          body: `<p><strong>${customerName}</strong> finished onboarding for <strong>${orderTitle}</strong>.</p><p>The order is now awaiting delivery — you can upload the first cut whenever you're ready.</p>`,
          ...(orderUrl ? { cta: { label: "Open order", url: orderUrl } } : {}),
        }),
      };
    }
    case "payment_receipt": {
      const orderTitle = str(data.order_title, "your video");
      const amount = str(data.amount);
      const currency = str(data.currency, "USD");
      const downloadUrl = str(data.download_url);
      return {
        subject: `Receipt — ${orderTitle}`,
        html: emailShell({
          heading: "Payment received",
          body: `<p>Thanks — your payment for <strong>${orderTitle}</strong> is confirmed.</p>${amount ? `<p>Amount: <strong>$${amount} ${currency}</strong></p>` : ""}<p>Your final video is ready to download.</p>`,
          cta: { label: "Download your video", url: downloadUrl },
        }),
      };
    }
  }
}

export async function sendTemplateEmail(args: { to: string; template: EmailTemplate; data: Record<string, unknown> }): Promise<void> {
  const { subject, html } = renderTemplate(args.template, args.data);
  await sendEmail({ to: args.to, subject, html });
}
