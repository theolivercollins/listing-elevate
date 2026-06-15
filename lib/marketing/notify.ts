const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Listing Elevate <noreply@listingelevate.com>";

export interface NotifyOptions {
  subject: string;
  text: string;
  to?: string;
  from?: string;
}

// Sends an operational alert via Resend.
// Returns false (no-op) when RESEND_API_KEY or MARKETING_ALERT_EMAIL_TO are unset.
// Never throws - alerts must not break user-facing paths.
export async function notify(opts: NotifyOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = opts.to ?? process.env.MARKETING_ALERT_EMAIL_TO;
  if (!apiKey || !to) {
    console.warn(`notify skipped (apiKey=${!!apiKey} to=${!!to}): "${opts.subject}"`);
    return false;
  }
  const from = opts.from ?? process.env.MARKETING_ALERT_EMAIL_FROM ?? DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: opts.subject, text: opts.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`notify Resend ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("notify fetch failed:", (err as Error).message);
    return false;
  }
}
