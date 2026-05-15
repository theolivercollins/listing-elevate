import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import { buildInvoice } from '../../../lib/operator-studio/invoice-data';
import { formatInvoiceSummary } from '../../../lib/operator-studio/invoice';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { client_id, from, to } = req.body ?? {};
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  try {
    const { summary } = await buildInvoice({ client_id, from, to });
    return res.status(200).json({ text: formatInvoiceSummary(summary), data: summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
    console.error('[invoice-summary]', err);
    return res.status(500).json({ error: msg });
  }
}
