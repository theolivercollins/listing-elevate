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
