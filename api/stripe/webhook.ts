/**
 * POST /api/stripe/webhook
 *
 * Receives and processes Stripe webhook events.
 *
 * IMPORTANT: Vercel's default body parser is disabled so we can read the raw
 * bytes required by stripe.webhooks.constructEvent for signature verification.
 *
 * Events handled:
 *   checkout.session.completed  — marks property paid + fires pipeline
 *                                  (or updates user_profiles for voice_clone_setup)
 *   checkout.session.expired    — marks stripe_payment_status='cancelled'
 *   payment_intent.payment_failed — marks stripe_payment_status='failed'
 *
 * All other event types → 200 no-op (Stripe will not retry).
 * Signature verification failure → 400 (Stripe will retry).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type Stripe from 'stripe';
import { getSupabase } from '../../lib/db.js';
import { verifyWebhookSignature } from '../../lib/billing/stripe.js';
import { runPipeline } from '../../lib/pipeline.js';

// Disable Vercel's built-in body parser — we need the raw bytes to verify
// the Stripe webhook signature.
export const config = { api: { bodyParser: false } };

/** Read the raw request body as a Buffer. */
async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Read raw body for signature verification.
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stripe/webhook] Failed to read request body:', msg);
    return res.status(400).json({ error: 'Failed to read request body' });
  }

  const signature = req.headers['stripe-signature'] as string | undefined;
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  // 2. Verify signature.
  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stripe/webhook] Signature verification failed:', msg);
    return res.status(400).json({ error: `Webhook signature verification failed: ${msg}` });
  }

  // 3. Dispatch on event type. All handlers are wrapped so errors don't 500 —
  //    we always return 200 to Stripe to prevent indefinite retries.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      default:
        // Unknown event type — log and no-op. Return 200 so Stripe doesn't retry.
        console.log(`[stripe/webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    // Log but still return 200 to avoid Stripe retry storm.
    // For critical failures, alert via log monitoring.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/webhook] Handler error for ${event.type}:`, msg, err);
  }

  return res.status(200).json({ received: true });
}

// ── checkout.session.completed ───────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata ?? {};
  const purpose = metadata.purpose;

  if (purpose === 'voice_clone_setup') {
    // Voice-clone setup payment — update user_profiles, don't touch properties.
    await handleVoiceCloneSetupCompleted(session, metadata);
    return;
  }

  // Per-order payment — look up property and fire pipeline.
  await handleOrderPaymentCompleted(session);
}

async function handleVoiceCloneSetupCompleted(
  session: Stripe.Checkout.Session,
  metadata: Record<string, string>,
) {
  const userId = metadata.userId;
  if (!userId) {
    console.error('[stripe/webhook] voice_clone_setup session missing userId in metadata', session.id);
    return;
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      voice_clone_paid_cents: 12500,
      voice_clone_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[stripe/webhook] Failed to update user_profiles for voice_clone_setup:', error.message);
    throw error;
  }

  console.log(`[stripe/webhook] voice_clone_setup payment confirmed for user ${userId}`);
}

async function handleOrderPaymentCompleted(session: Stripe.Checkout.Session) {
  // client_reference_id is the propertyId (set in createCheckoutSession).
  const propertyId = session.client_reference_id;
  if (!propertyId) {
    console.error('[stripe/webhook] checkout.session.completed missing client_reference_id', session.id);
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  const supabase = getSupabase();

  // Mark property as paid and queue it.
  const { data: updatedProperty, error } = await supabase
    .from('properties')
    .update({
      status: 'queued',
      stripe_payment_status: 'paid',
      stripe_paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
    .select('submitted_by, add_voice_clone')
    .single();

  if (error) {
    console.error(`[stripe/webhook] Failed to mark property ${propertyId} as paid:`, error.message);
    throw error;
  }

  // If this order included a voice clone setup fee, record the payment on
  // user_profiles (idempotent: skip if already set).
  if (updatedProperty?.add_voice_clone && updatedProperty?.submitted_by) {
    const userId = updatedProperty.submitted_by as string;
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('voice_clone_paid_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingProfile?.voice_clone_paid_at) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({
          voice_clone_paid_cents: 12500,
          voice_clone_paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (profileError) {
        // Log but don't rethrow — property is already marked paid, pipeline
        // should still fire. This can be reconciled manually.
        console.error(`[stripe/webhook] Failed to record voice_clone payment on user_profiles for user ${userId}:`, profileError.message);
      } else {
        console.log(`[stripe/webhook] Voice clone payment recorded for user ${userId}`);
      }
    } else {
      console.log(`[stripe/webhook] Voice clone already paid for user ${userId} — skipping (idempotent)`);
    }
  }

  console.log(`[stripe/webhook] Property ${propertyId} marked paid. Firing pipeline...`);

  // Fire pipeline directly (no network hop). runPipeline is async and can
  // take up to 300s — fire without await so the webhook response is fast.
  // Errors from runPipeline are caught inside the function and written to
  // pipeline_logs; they do NOT propagate here.
  runPipeline(propertyId).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/webhook] runPipeline error for property ${propertyId}:`, msg);
  });
}

// ── checkout.session.expired ─────────────────────────────────────────────────

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const propertyId = session.client_reference_id;
  if (!propertyId) return; // voice_clone_setup sessions have no propertyId

  const supabase = getSupabase();
  const { error } = await supabase
    .from('properties')
    .update({
      stripe_payment_status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId);

  if (error) {
    console.error(`[stripe/webhook] Failed to mark session expired for property ${propertyId}:`, error.message);
    throw error;
  }

  console.log(`[stripe/webhook] Checkout session expired for property ${propertyId} — status stays pending_payment, payment_status=cancelled`);
}

// ── payment_intent.payment_failed ────────────────────────────────────────────

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  // Look up the property by stripe_payment_intent_id (if already set) or
  // by correlating via the session. In practice, payment_failed fires before
  // checkout.session.completed so the payment_intent_id may not be on the
  // row yet — look up by the payment intent ID.
  const supabase = getSupabase();
  const { error } = await supabase
    .from('properties')
    .update({
      stripe_payment_status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  // If no row matched (payment_intent_id not yet written), that's ok — the
  // checkout.session.expired event will handle cleanup.
  if (error) {
    console.error('[stripe/webhook] Failed to mark payment_failed:', error.message);
    throw error;
  }

  console.log(`[stripe/webhook] payment_intent.payment_failed for ${paymentIntent.id}`);
}
