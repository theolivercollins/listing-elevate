/**
 * Owner test-bypass for Stripe payments.
 *
 * When LE_OWNER_BYPASS_EMAILS env var lists an authed user's email AND
 * the user has profile.role === 'admin', the upload flow skips Stripe
 * Checkout entirely — the property is marked paid (amount_cents=0) and
 * the pipeline fires inline.
 *
 * Bypassed orders are identifiable by stripe_session_id IS NULL +
 * stripe_payment_status='paid' + stripe_amount_cents=0.
 */

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface BypassCheckInput {
  email: string | null | undefined;
  role: "admin" | "user";
}

export function isOwnerBypassEligible(input: BypassCheckInput): boolean {
  if (input.role !== "admin") return false;
  if (!input.email) return false;
  const allowlist = parseAllowlist(process.env.LE_OWNER_BYPASS_EMAILS);
  if (allowlist.size === 0) return false;
  return allowlist.has(input.email.trim().toLowerCase());
}
