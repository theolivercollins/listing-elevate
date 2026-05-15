/**
 * POST /api/properties/:id/resume-checkout
 *
 * Re-creates a Stripe Checkout Session for a property that is still in
 * 'pending_payment' status (e.g. the customer cancelled and wants to retry).
 * Updates stripe_session_id on the property row to the new session.
 *
 * Auth: the request must come from the user who originally submitted the
 * property (submitted_by field).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../../lib/db.js';
import { requireAuth } from '../../../lib/auth.js';
import {
  createCheckoutSession,
  formatLineItemsForOrder,
  sumLineItemsCents,
} from '../../../lib/billing/stripe.js';
import type { Property } from '../../../lib/types.js';

function resolveOrigin(req: VercelRequest): string {
  const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
  if (forwardedHost) {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  const origin = req.headers.origin as string | undefined;
  if (origin) return origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:5173';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const propertyId = req.query.id as string;
  if (!propertyId) {
    return res.status(400).json({ error: 'Missing property id' });
  }

  const supabase = getSupabase();

  // Load the property.
  const { data: property, error: fetchErr } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single();

  if (fetchErr || !property) {
    return res.status(404).json({ error: 'Property not found' });
  }

  // Only the original submitter may resume checkout.
  if (property.submitted_by && property.submitted_by !== auth.user.id) {
    return res.status(403).json({ error: 'Not authorized to resume checkout for this property' });
  }

  // Only pending_payment properties can be retried.
  if (property.status !== 'pending_payment') {
    return res.status(409).json({
      error: `Cannot resume checkout — property status is '${property.status}'. Only 'pending_payment' properties can retry.`,
    });
  }

  try {
    const lineItems = formatLineItemsForOrder(property as unknown as Property);
    const amountCents = sumLineItemsCents(lineItems);
    const origin = resolveOrigin(req);

    const { sessionId, url: checkoutUrl } = await createCheckoutSession({
      propertyId: property.id,
      userId: auth.user.id,
      lineItems,
      successUrl: `${origin}/upload/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/upload/cancelled?session_id={CHECKOUT_SESSION_ID}&property_id=${property.id}`,
    });

    await supabase
      .from('properties')
      .update({
        stripe_session_id: sessionId,
        stripe_amount_cents: amountCents,
        stripe_payment_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', propertyId);

    return res.status(200).json({ checkoutUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resume-checkout] error:', msg, err);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: msg });
  }
}
