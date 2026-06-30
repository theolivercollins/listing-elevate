import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const [analysis, director, qc] = await Promise.all([
    import('../../lib/prompts/photo-analysis.js'),
    import('../../lib/prompts/director.js'),
    import('../../lib/prompts/qc-evaluator.js'),
  ]);

  return res.status(200).json({
    analysis: analysis.PHOTO_ANALYSIS_SYSTEM,
    director: director.DIRECTOR_SYSTEM,
    qc: qc.QC_SYSTEM,
  });
}
