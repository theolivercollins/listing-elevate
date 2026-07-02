/**
 * Minimal Resend HTTP client for transactional email.
 *
 * Resend is NOT an installed SDK dependency in this repo (grepped: no
 * "resend"/"sendgrid"/"postmark"/"nodemailer" usage anywhere before this
 * file). A plain `fetch` against Resend's HTTP API avoids adding a new
 * package — the same raw-fetch-over-SDK approach already used for Sendy in
 * api/blog/emails/[id]/send.ts.
 *
 * Required env vars (read by the caller, not this module):
 *   RESEND_API_KEY     — from the Resend dashboard → API Keys.
 *   WELCOME_EMAIL_FROM — a verified sender, e.g. "Listing Elevate <hello@listingelevate.com>".
 *                        Resend rejects sends from unverified domains.
 */

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  /** Resend's message id, or "unknown" if the response body didn't include one. */
  id: string;
}

/** Narrow, defensive read of a Resend JSON response without `any`. */
function readStringField(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Sends one transactional email via the Resend API.
 *
 * Throws on any non-2xx response or network failure — callers are
 * responsible for translating that into their own retry/dedupe behavior.
 */
export async function sendResendEmail(
  params: SendEmailParams,
  apiKey: string,
): Promise<SendEmailResult> {
  let resp: Response;
  try {
    resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
  } catch (err) {
    throw new Error(
      `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rawText = await resp.text();
  let parsed: unknown = undefined;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }
  }

  if (!resp.ok) {
    const message = readStringField(parsed, "message") ?? (rawText || `HTTP ${resp.status}`);
    throw new Error(`Resend send failed (${resp.status}): ${message}`);
  }

  return { id: readStringField(parsed, "id") ?? "unknown" };
}
