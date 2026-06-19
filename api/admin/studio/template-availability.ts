import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { isTemplateConfigured } from '../../../lib/assembly/template-resolver.js';

// The full matrix the studio form currently offers.
const VIDEO_TYPES = ['just_listed', 'just_pended', 'just_closed'] as const;
const DURATIONS = [15, 30, 60] as const;
const ORIENTATIONS = ['horizontal'] as const;

type VideoType = typeof VIDEO_TYPES[number];
type Duration = typeof DURATIONS[number];
type Orientation = typeof ORIENTATIONS[number];

interface ComboAvailability {
  video_type: VideoType;
  duration: Duration;
  orientation: Orientation;
  available: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const combos: ComboAvailability[] = [];

  for (const video_type of VIDEO_TYPES) {
    for (const duration of DURATIONS) {
      for (const orientation of ORIENTATIONS) {
        // horizontal → 16:9, vertical → 9:16 (only horizontal offered right now)
        const aspectRatio = orientation === 'horizontal' ? '16:9' as const : '9:16' as const;
        const available = isTemplateConfigured({
          selectedPackage: video_type,
          selectedDuration: duration,
          aspectRatio,
        });
        combos.push({ video_type, duration, orientation, available });
      }
    }
  }

  return res.status(200).json({ combos });
}
