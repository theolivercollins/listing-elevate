/**
 * DB access for the "Welcome to Listing Elevate" send-once ledger
 * (public.welcome_emails, migration 102) used by api/hooks/welcome-email.ts.
 */

import { getSupabase } from "../db.js";
import { isNonProdEnv } from "../env.js";

/**
 * Atomically claims the right to send the welcome email to this user.
 *
 * Implemented as `INSERT ... ON CONFLICT (user_id) DO NOTHING` via
 * supabase-js `.upsert(..., { ignoreDuplicates: true })`. PostgREST returns
 * the inserted row when the insert wins the race and an empty array when a
 * row for this user_id already existed — so `data.length > 0` tells us
 * whether THIS call is the one responsible for sending. Safe under
 * concurrent/duplicate webhook deliveries for the same user.
 *
 * Returns true when this call claimed the send (caller must now send the
 * email); false when a row already exists (already sent, or another
 * in-flight call owns the claim) and the caller must skip sending.
 */
export async function claimWelcomeEmail(userId: string, email: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("welcome_emails")
    .upsert({ user_id: userId, email }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("user_id");

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Marks a claimed row as successfully sent (idempotency ledger + audit trail). */
export async function markWelcomeEmailSent(
  userId: string,
  providerMessageId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("welcome_emails")
    .update({
      sent_at: new Date().toISOString(),
      provider: "resend",
      provider_message_id: providerMessageId,
    })
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Looks up a user's account email by id via the service-role Auth Admin API.
 *
 * This is the ONLY trusted source for the welcome-email recipient. The
 * Database Webhook payload's `record.email` is not a trusted input for
 * delivery purposes (see api/hooks/welcome-email.ts FIX 1 in the 2026-07
 * security audit) — always derive the send target from here instead.
 *
 * Returns undefined when the user id doesn't resolve to an account, or the
 * account has no email on file (e.g. phone-only signup). Callers must treat
 * either case as "cannot send" rather than falling back to any other value.
 */
export async function lookupUserEmailById(userId: string): Promise<string | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  const email = data?.user?.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

/**
 * Releases a claim after a failed send so a retried webhook delivery (or a
 * manual backfill) can attempt the send again.
 *
 * Only deletes rows that never successfully sent (`sent_at IS NULL`) — this
 * can never undo a real send, even if called with a stale/duplicate userId.
 */
export async function releaseWelcomeEmailClaim(userId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("welcome_emails")
    .delete()
    .eq("user_id", userId)
    .is("sent_at", null);
  if (error) throw error;
}

/**
 * Records the $0 cost of a welcome-email send in cost_events, per the repo's
 * first-class cost-tracking convention (every external API call, even $0
 * ones). Resend isn't part of the video-pipeline domain recordCostEvent()
 * models (no propertyId, no pipeline "stage"), so this writes directly —
 * the same pattern lib/blog-engine/cost.ts's recordBlogCost() uses for the
 * blog/email-campaign domain. Migration 102 widens cost_events_provider_check
 * to allow provider='resend'; without it this insert hits a CHECK violation.
 */
export async function recordWelcomeEmailCost(
  userId: string,
  providerMessageId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("cost_events").insert({
    property_id: null,
    stage: "welcome_email",
    provider: "resend",
    unit_type: null,
    cost_cents: 0,
    metadata: { user_id: userId, provider_message_id: providerMessageId },
    is_test: isNonProdEnv(),
  });
  if (error) throw error;
}
