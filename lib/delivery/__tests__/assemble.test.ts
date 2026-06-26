/**
 * Unit tests for lib/delivery/assemble.ts — runAssembleStage error handling.
 *
 * Focus: timeout branch (isAssemblyTimeout) behaves correctly for both
 * auto_run=true (no error row — sweep resumes via job token) and
 * auto_run=false (error row written so operator sees "timed out" in studio).
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { runAssembleStage } from '../assemble.js';

// ─── MODULE MOCKS ─────────────────────────────────────────────────────────────

vi.mock('../../client.js', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('../runs.js', () => ({
  getRun: vi.fn(),
  getVariantsForRun: vi.fn().mockResolvedValue([]),
  advanceRun: vi.fn(),
  setRunError: vi.fn().mockResolvedValue(undefined),
}));

// rerunAssembly is dynamically imported inside runAssembleStage.
vi.mock('../../pipeline.js', () => ({
  rerunAssembly: vi.fn(),
}));

// resolveGate is dynamically imported for the inline autopilot kick.
vi.mock('../auto-run.js', () => ({
  resolveGate: vi.fn().mockResolvedValue({ action: 'noop' }),
}));

import { getSupabase } from '../../client.js';
import { getRun, advanceRun, setRunError } from '../runs.js';
import { rerunAssembly } from '../../pipeline.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  property_id: string;
  stage: string;
  auto_run: boolean;
  music_track_id: string | null;
  voiceover_audio_url: string | null;
  voiceover_script: string | null;
  voiceover_voice_id: string | null;
  listing_details: Record<string, unknown> | null;
};

function makeRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    property_id: 'prop-1',
    stage: 'assembling',
    auto_run: true,
    music_track_id: null,
    voiceover_audio_url: null,
    voiceover_script: null,
    voiceover_voice_id: null,
    listing_details: null,
    ...overrides,
  };
}

/** Build a minimal Supabase mock that lets assemble.ts complete its property writes. */
function makeDb(propData = { horizontal_video_url: null, vertical_video_url: null, selected_orientation: 'horizontal' }) {
  const eq = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'scenes') {
        return { update: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'properties') {
        return {
          update: vi.fn().mockReturnValue({ eq }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: propData, error: null }),
            }),
          }),
        };
      }
      return { update: vi.fn().mockReturnValue({ eq }), insert: vi.fn().mockResolvedValue({ error: null }) };
    }),
  };
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('runAssembleStage — timeout error-row branching (Fix 4)', () => {
  it('auto_run=true + timeout: does NOT write error row (sweep resumes via job token)', async () => {
    const run = makeRun({ auto_run: true });
    (getRun as Mock).mockResolvedValue(run);
    (getSupabase as Mock).mockReturnValue(makeDb());

    // rerunAssembly throws a tagged timeout error — same as when Vercel kills the fn.
    const timeoutErr = Object.assign(
      new Error('[ASSEMBLY_TIMEOUT] Horizontal render timed out after 240000ms'),
      { isAssemblyTimeout: true },
    );
    (rerunAssembly as Mock).mockRejectedValue(timeoutErr);

    // runAssembleStage must rethrow so the caller (resolveAssembling) can detect it.
    await expect(runAssembleStage('run-1')).rejects.toThrow('[ASSEMBLY_TIMEOUT]');

    // setRunError must NOT be called — run stays clean for autopilot to resume.
    expect(setRunError).not.toHaveBeenCalled();
  });

  it('auto_run=false + timeout: writes visible error row so operator can retry', async () => {
    const run = makeRun({ auto_run: false });
    (getRun as Mock).mockResolvedValue(run);
    (getSupabase as Mock).mockReturnValue(makeDb());

    const timeoutErr = Object.assign(
      new Error('[ASSEMBLY_TIMEOUT] Horizontal render timed out after 240000ms'),
      { isAssemblyTimeout: true },
    );
    (rerunAssembly as Mock).mockRejectedValue(timeoutErr);

    // Must still rethrow.
    await expect(runAssembleStage('run-1')).rejects.toThrow('[ASSEMBLY_TIMEOUT]');

    // setRunError MUST be called — operator needs visible state in studio.
    expect(setRunError).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('timed out'),
    );
  });

  it('non-timeout error: always writes error row regardless of auto_run', async () => {
    const run = makeRun({ auto_run: true });
    (getRun as Mock).mockResolvedValue(run);
    (getSupabase as Mock).mockReturnValue(makeDb());

    const hardErr = new Error('Creatomate returned 500');
    (rerunAssembly as Mock).mockRejectedValue(hardErr);

    await expect(runAssembleStage('run-1')).rejects.toThrow('Creatomate returned 500');

    // For a real provider failure, setRunError is always called.
    expect(setRunError).toHaveBeenCalledWith('run-1', expect.stringContaining('Creatomate returned 500'));
  });
});
