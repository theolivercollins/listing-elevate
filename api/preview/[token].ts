import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../lib/operator-studio/preview-tokens.js';
import { fetchByToken, recordPreviewView, insertClientNote } from '../../lib/operator-studio/preview.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') {
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    void recordPreviewView(token);
    return res.status(200).json({
      address: result.property.address,
      video_url: result.property.vertical_video_url ?? result.property.horizontal_video_url,
      brand: result.client
        ? { logo: result.client.brand_logo_url, agent_name: result.client.agent_name, name: result.client.name }
        : null,
    });
  }

  if (req.method === 'POST') {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'note too long' });
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    await insertClientNote({ property_id: result.property.id, source: 'client_preview', body });
    return res.status(201).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
