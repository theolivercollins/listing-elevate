import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getClient, updateClient, archiveClient } from '../../../../lib/operator-studio/clients.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.query.id);

  if (req.method === 'GET') {
    const row = await getClient(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ client: row });
  }
  if (req.method === 'PATCH') {
    const row = await updateClient(id, req.body);
    return res.status(200).json({ client: row });
  }
  if (req.method === 'DELETE') {
    const row = await archiveClient(id);
    return res.status(200).json({ client: row });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
