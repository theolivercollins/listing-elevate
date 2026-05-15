import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { listClients, createClient } from '../../../../lib/operator-studio/clients.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const includeArchived = req.query.include_archived === 'true';
    const rows = await listClients({ includeArchived });
    return res.status(200).json({ clients: rows });
  }
  if (req.method === 'POST') {
    try {
      const row = await createClient(req.body);
      return res.status(201).json({ client: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(/required|invalid/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
