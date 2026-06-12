import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getSupabase } from '../../../lib/db.js';
import { verifyAuth } from '../../../lib/auth.js';

/**
 * Minimal inline label map for the GET response.
 *
 * This is intentionally a subset of src/lib/order-status.ts: the GET branch
 * is unauthenticated (delivery-email links) so we only need a safe, non-sensitive
 * label string. The canonical ORDER_STATUS_MAP in src/ cannot be imported here
 * because tsconfig.api.json only covers api/ and lib/ — not src/.
 *
 * Keep in sync with src/lib/order-status.ts (labels only; colors/bg not needed here).
 */
const STATUS_LABEL: Record<string, string> = {
  queued:          'Received',
  pending:         'Received',
  pending_payment: 'Awaiting payment',
  ingesting:       'Crafting scenes',
  analyzing:       'Crafting scenes',
  scripting:       'Crafting scenes',
  generating:      'Rendering',
  retry_1:         'Rendering',
  retry_2:         'Rendering',
  qc:              'In review',
  assembling:      'In review',
  qc_pass:         'Delivered',
  complete:        'Delivered',
  delivered:       'Delivered',
  needs_review:    'Needs attention',
  qc_soft_reject:  'Needs attention',
  qc_hard_reject:  'Needs attention',
  failed:          'Needs attention',
  archived:        'Archived',
};

/** Returns the user-facing label for a status string, falling back to the raw value. */
function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

// Statuses that any authenticated caller (owner or admin) may set.
// The full set is available to admins only; owners are further restricted
// to OWNER_PATCH_STATUSES so they cannot corrupt pipeline/ops state by
// flipping their own orders to 'complete', 'delivered', or 'failed'.
const ALLOWED_PATCH_STATUSES = new Set([
  'delivered',
  'archived',
  'complete',
  'needs_review',
  'failed',
]);

// Non-admin owners may only archive their own properties — no other status
// transition has a legitimate owner-facing use case today.
const OWNER_PATCH_STATUSES = new Set(['archived']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'PATCH') {
    // Auth gate: caller must have a valid session AND be the property owner or admin.
    // verifyAuth is used directly (not requireAuth) so we can distinguish 401 from 403.
    const auth = await verifyAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const id = req.query.id as string;
      const { status } = req.body as { status?: string };

      if (!status || !ALLOWED_PATCH_STATUSES.has(status)) {
        return res.status(400).json({
          error: `Invalid status. Allowed values: ${[...ALLOWED_PATCH_STATUSES].join(', ')}`,
        });
      }

      let property;
      try {
        property = await getProperty(id);
      } catch {
        // getProperty throws (Supabase single()) when no row matches — return 404.
        return res.status(404).json({ error: 'Property not found' });
      }

      // Only the property owner (submitted_by) or an admin may mutate status.
      const isOwner = property.submitted_by === auth.user.id;
      const isAdmin = auth.profile.role === 'admin';
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Non-admin owners are restricted to a safe subset of statuses so they
      // cannot flip pending_payment → complete/delivered and corrupt ops state.
      if (!isAdmin && !OWNER_PATCH_STATUSES.has(status)) {
        return res.status(403).json({
          error: `Forbidden: owners may only set status to: ${[...OWNER_PATCH_STATUSES].join(', ')}`,
        });
      }

      const { error } = await getSupabase()
        .from('properties')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ id, status });
    } catch {
      return res.status(500).json({ error: 'Failed to update status' });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // GET — open to unauthenticated callers (delivery-email links) but returns
  // additional rich fields to authenticated owners/admins.
  //
  // Unauthenticated → exactly { status, label, currentStage, totalStages }
  // Authenticated (owner or admin) → adds address, horizontalVideoUrl,
  //   verticalVideoUrl, processingTimeMs, clipsCompleted, clipsTotal, createdAt
  //
  // The test suite asserts the unauthenticated shape has EXACTLY 4 keys; do not
  // add fields to the unauthenticated branch without updating that test.
  try {
    const id = req.query.id as string;
    const property = await getProperty(id);

    const stages = ['queued', 'analyzing', 'scripting', 'generating', 'qc', 'assembling', 'complete'];
    const currentStageIndex = stages.indexOf(property.status);

    const base = {
      status: property.status,
      label: statusLabel(property.status),
      currentStage: currentStageIndex,
      totalStages: stages.length,
    };

    // Only attempt auth verification if a Bearer token is present. This keeps
    // the unauthenticated (email-link) path free of any auth DB call and
    // satisfies the test assertion that verifyAuth is never called without a token.
    const hasToken = req.headers.authorization?.startsWith('Bearer ');
    if (hasToken) {
      const auth = await verifyAuth(req);
      if (auth) {
        const isOwner = property.submitted_by === auth.user.id;
        const isAdmin = auth.profile.role === 'admin';
        if (isOwner || isAdmin) {
          return res.status(200).json({
            ...base,
            address: property.address,
            horizontalVideoUrl: property.horizontal_video_url ?? null,
            verticalVideoUrl: property.vertical_video_url ?? null,
            processingTimeMs: property.processing_time_ms ?? null,
            clipsCompleted: 0,
            clipsTotal: 0,
            createdAt: property.created_at,
          });
        }
      }
    }

    return res.status(200).json(base);
  } catch {
    return res.status(404).json({ error: 'Property not found' });
  }
}
