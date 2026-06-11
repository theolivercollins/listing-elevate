import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../../lib/operator-studio/preview-tokens.js';
import {
  fetchByToken,
  stampApproval,
  insertPreviewNote,
} from '../../../lib/operator-studio/preview.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const result = await fetchByToken(token);
  if (!result || result.expired) return res.status(404).json({ error: 'not_found' });

  // Pre-migration guard: if the property_previews capability columns (allow_approve,
  // approved_at) haven't been added yet (migration 083 not applied), result.preview
  // is null. Proceeding to stampApproval would throw Postgres 42703 (column not found)
  // and insertPreviewNote would violate the un-extended CHECK constraint.
  // Return 503 so the client gets a clear, retryable signal rather than a raw 500.
  if (result.preview === null) {
    return res.status(503).json({ error: 'not_ready', message: 'Preview capabilities not yet available — migration pending' });
  }

  // Capability check
  const allowApprove = result.preview.allow_approve;
  if (!allowApprove) return res.status(403).json({ error: 'not_allowed' });

  const { approved_at, already_approved } = await stampApproval(token);

  if (!already_approved) {
    // First approval — insert activity note so it surfaces in the property's history
    await insertPreviewNote({
      property_id: result.property.id,
      source: 'client_approval',
      body: 'Approved via preview link',
    });
  }

  return res.status(200).json({ ok: true, approved_at });
}
