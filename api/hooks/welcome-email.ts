/**
 * POST /api/hooks/welcome-email
 *
 * Fired by a Supabase Database Webhook on `auth.users` INSERT (new signup).
 * Sends the "Welcome to Listing Elevate" transactional email
 * (supabase/templates/welcome.html, see lib/email/welcome-template.ts)
 * via Resend, at most once per user.
 *
 * Feature flag: WELCOME_EMAIL_ENABLED !== 'true' → 200 no-op, no side
 * effects at all. Default OFF — no email sends until this is explicitly
 * set to 'true'. Checked first (before method/auth), matching the
 * DRIVE_INTAKE_ENABLED gate convention in api/drive/webhook.ts and
 * api/telegram/webhook.ts.
 *
 * Auth: `x-le-webhook-secret` header must match WELCOME_EMAIL_WEBHOOK_SECRET,
 * compared in constant time (crypto.timingSafeEqual) so response timing
 * can't be used to brute-force the secret. Missing header, duplicated
 * header, mismatched value, OR an unconfigured (unset) expected secret all
 * → 401. Failing closed when the env var is unset prevents an unconfigured
 * deploy from accepting unauthenticated requests (same fail-closed pattern
 * as TELEGRAM_WEBHOOK_SECRET in api/telegram/webhook.ts). This endpoint
 * must never behave as an open email-sending relay.
 * WELCOME_EMAIL_WEBHOOK_SECRET should be a high-entropy value — at least 32
 * bytes of randomness (e.g. `openssl rand -hex 32`) — since this header is
 * the entire authentication boundary for this endpoint.
 *
 * Event shape: only `type: "INSERT"` on `table: "users"` in `schema: "auth"`
 * is processed. Anything else (wrong table/event, replayed/misconfigured
 * delivery) → 200 no-op so a misconfigured webhook fails fast without
 * erroring or retrying forever.
 *
 * Recipient trust boundary: the send target is ALWAYS derived server-side
 * from a service-role lookup of the user id (supabase.auth.admin.getUserById,
 * see lib/email/welcome-db.ts lookupUserEmailById) — never from the webhook
 * payload's `record.email`, which is treated as audit-only. This lookup runs
 * BEFORE the send-once claim is taken, so a lookup failure never burns a
 * claim: a later retry can simply look up again with nothing to clean up.
 *
 * Non-prod write guard: when isNonProdEnv() is true (dev/preview, unless
 * LE_ALLOW_NONPROD_WRITES=true) → 200 no-op. Matches the repo-wide
 * VERCEL_ENV==='production' || LE_ALLOW_NONPROD_WRITES==='true' pattern
 * (lib/env.ts) so this never emails real users from a preview deploy.
 *
 * Idempotency: an atomic upsert-with-ignoreDuplicates claim on
 * welcome_emails.user_id (migration 102) guarantees at most one send per
 * user even under concurrent or retried webhook deliveries. The claim is
 * released ONLY when the Resend send itself fails — never when a post-send
 * bookkeeping step (markWelcomeEmailSent / recordWelcomeEmailCost) fails.
 * Releasing on a bookkeeping failure would let a webhook retry see an
 * unclaimed row and send a duplicate email even though the first send
 * already succeeded, which breaks "at most once". Bookkeeping failures are
 * logged and swallowed instead.
 *
 * Required Supabase Database Webhook config (Dashboard → Database →
 * Webhooks → Create a new hook):
 *   Table:        auth.users (schema: auth)
 *   Events:       INSERT
 *   Type:         HTTP Request
 *   Method:       POST
 *   URL:          https://listingelevate.com/api/hooks/welcome-email
 *   HTTP Headers: x-le-webhook-secret: <value of WELCOME_EMAIL_WEBHOOK_SECRET>
 */

import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  claimWelcomeEmail,
  markWelcomeEmailSent,
  releaseWelcomeEmailClaim,
  recordWelcomeEmailCost,
  lookupUserEmailById,
} from "../../lib/email/welcome-db.js";
import { sendResendEmail } from "../../lib/email/resend-client.js";
import { WELCOME_EMAIL_HTML, WELCOME_EMAIL_SUBJECT } from "../../lib/email/welcome-template.js";
import { isNonProdEnv } from "../../lib/env.js";

interface SupabaseUserWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    id?: unknown;
    /**
     * Audit-only. NEVER used to choose the send target — see the recipient
     * trust boundary note above. The real recipient always comes from
     * lookupUserEmailById(userId).
     */
    email?: unknown;
  };
}

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Constant-time comparison of the `x-le-webhook-secret` header against the
 * configured secret. Fails closed (false) when:
 *   - the expected secret is unset (unconfigured deploy),
 *   - the header is missing, or
 *   - the header was sent more than once (Node folds duplicate headers into
 *     a string[], which is rejected outright rather than compared).
 * Buffer lengths are checked before calling timingSafeEqual, which throws
 * on mismatched lengths — this avoids leaking anything via an exception
 * while still failing closed for any length mismatch.
 */
function isAuthorizedRequest(expectedSecret: string | undefined, incomingHeader: unknown): boolean {
  if (!expectedSecret) return false;
  if (typeof incomingHeader !== "string") return false;

  const expected = Buffer.from(expectedSecret, "utf8");
  const incoming = Buffer.from(incomingHeader, "utf8");
  if (expected.length !== incoming.length) return false;

  return crypto.timingSafeEqual(expected, incoming);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // Feature flag — default OFF. No parsing, no auth check, no DB/network
  // call happens at all while this is unset.
  if (process.env.WELCOME_EMAIL_ENABLED !== "true") {
    return res.status(200).json({ ok: true, skipped: "disabled" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth — shared secret set as a custom HTTP header on the Supabase
  // Database Webhook config. Fail closed when unconfigured.
  const expectedSecret = process.env.WELCOME_EMAIL_WEBHOOK_SECRET;
  const incomingSecret = req.headers["x-le-webhook-secret"];
  if (!isAuthorizedRequest(expectedSecret, incomingSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = (req.body ?? {}) as SupabaseUserWebhookPayload;

  // Event-shape assertion — this handler only knows how to process an
  // auth.users INSERT (new signup). A misconfigured Database Webhook or a
  // replayed/mistyped delivery must fail fast as a no-op rather than
  // attempt to interpret a shape it wasn't built for.
  if (payload.type !== "INSERT" || payload.table !== "users" || payload.schema !== "auth") {
    return res.status(200).json({ ok: true, skipped: "unexpected_event" });
  }

  const userId = typeof payload.record?.id === "string" ? payload.record.id : undefined;
  if (!userId) {
    return res.status(400).json({ error: "record.id is required" });
  }

  // Non-prod write guard — never send a real email from dev/preview unless
  // Oliver has explicitly opted in via LE_ALLOW_NONPROD_WRITES=true.
  if (isNonProdEnv()) {
    return res.status(200).json({ ok: true, skipped: "nonprod" });
  }

  // FIX 1 — the recipient is derived from a trusted, server-side lookup,
  // never from the webhook payload. Runs BEFORE the send-once claim: if the
  // lookup fails or the account has no usable email, no claim row is ever
  // created, so a later retry can just look up again with nothing to undo.
  let lookedUpEmail: string | undefined;
  try {
    lookedUpEmail = await lookupUserEmailById(userId);
  } catch (err) {
    console.error(
      "[hooks/welcome-email] user lookup failed:",
      err instanceof Error ? err.message : String(err),
    );
    return res.status(500).json({ error: "Failed to look up user for welcome email" });
  }

  if (!lookedUpEmail || !EMAIL_SHAPE_RE.test(lookedUpEmail)) {
    return res.status(400).json({ error: "No deliverable email address on file for this user" });
  }

  if (typeof payload.record?.email === "string" && payload.record.email !== lookedUpEmail) {
    // Not an error — the payload's email is untrusted and never used for
    // delivery. Logged only for audit visibility into the mismatch.
    console.warn(
      "[hooks/welcome-email] payload record.email differs from the looked-up account email; sending to the looked-up address",
    );
  }

  let claimed: boolean;
  try {
    claimed = await claimWelcomeEmail(userId, lookedUpEmail);
  } catch (err) {
    console.error(
      "[hooks/welcome-email] claim failed:",
      err instanceof Error ? err.message : String(err),
    );
    return res.status(500).json({ error: "Failed to claim welcome-email send" });
  }

  if (!claimed) {
    return res.status(200).json({ ok: true, skipped: "already_sent" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WELCOME_EMAIL_FROM;
  if (!apiKey || !from) {
    await releaseWelcomeEmailClaim(userId).catch(() => {});
    return res.status(500).json({
      error: "RESEND_API_KEY and WELCOME_EMAIL_FROM must both be set before welcome emails can send",
    });
  }

  // FIX 3 — "at most once" must survive a post-send bookkeeping failure.
  // Only a failed SEND releases the claim. Once Resend has actually
  // accepted the send, nothing below may release the claim — a retry after
  // a bookkeeping failure must see the row still claimed and skip, not send
  // a duplicate email.
  let result: { id: string };
  try {
    result = await sendResendEmail(
      { to: lookedUpEmail, from, subject: WELCOME_EMAIL_SUBJECT, html: WELCOME_EMAIL_HTML },
      apiKey,
    );
  } catch (err) {
    await releaseWelcomeEmailClaim(userId).catch(() => {});
    console.error(
      "[hooks/welcome-email] send failed:",
      err instanceof Error ? err.message : String(err),
    );
    return res.status(500).json({ error: "Failed to send welcome email" });
  }

  // Bookkeeping below is logged and swallowed on failure — never releasing
  // the claim, since the email was already sent.
  try {
    await markWelcomeEmailSent(userId, result.id);
  } catch (markErr) {
    console.error(
      "[hooks/welcome-email] markWelcomeEmailSent failed after a successful send (claim retained to avoid a duplicate send on retry):",
      markErr instanceof Error ? markErr.message : String(markErr),
    );
  }

  // Cost-tracking must never fail an already-sent email's response.
  try {
    await recordWelcomeEmailCost(userId, result.id);
  } catch (costErr) {
    console.error(
      "[hooks/welcome-email] recordWelcomeEmailCost failed:",
      costErr instanceof Error ? costErr.message : String(costErr),
    );
  }

  return res.status(200).json({ ok: true, sent: true, id: result.id });
}
