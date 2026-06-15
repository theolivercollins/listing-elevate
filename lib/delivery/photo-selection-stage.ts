import { advanceRun, getRun } from './runs.js';
import type { DeliveryStage } from './state.js';

function isBenignAdvanceRace(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /stage moved|illegal transition/.test(msg);
}

export async function advanceRunToPhotoSelection(
  runId: string,
  initialStage: string | null,
): Promise<boolean> {
  let stage = initialStage;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (stage === 'photo_selection') return true;
    if (stage !== 'intake' && stage !== 'scraping') return false;

    const next: DeliveryStage = stage === 'intake' ? 'scraping' : 'photo_selection';
    try {
      await advanceRun(runId, next);
      stage = next;
    } catch (err) {
      if (!isBenignAdvanceRace(err)) throw err;
      const latest = await getRun(runId);
      stage = latest?.stage ?? null;
    }
  }

  return stage === 'photo_selection';
}
