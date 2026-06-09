import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetRun = vi.fn();
const mockGetVariantsForRun = vi.fn();
const mockGetEventsForRun = vi.fn();
const mockAdvanceRun = vi.fn();
const mockClearRunError = vi.fn();
const mockSetRunError = vi.fn();
const mockUpdateRun = vi.fn();
const mockRecordMlEvent = vi.fn();
const mockSetListingDetails = vi.fn();
const mockValidateListingDetails = vi.fn();
const mockRegenerateVariant = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbFrom = vi.fn();
const mockGenerateDeliveryScript = vi.fn();
const mockDbSelect = vi.fn();

vi.mock('../../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a) }));
vi.mock('../../../../../lib/delivery/runs', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  getVariantsForRun: (...a: unknown[]) => mockGetVariantsForRun(...a),
  getEventsForRun: (...a: unknown[]) => mockGetEventsForRun(...a),
  advanceRun: (...a: unknown[]) => mockAdvanceRun(...a),
  clearRunError: (...a: unknown[]) => mockClearRunError(...a),
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
  updateRun: (...a: unknown[]) => mockUpdateRun(...a),
  recordMlEvent: (...a: unknown[]) => mockRecordMlEvent(...a),
  setListingDetails: (...a: unknown[]) => mockSetListingDetails(...a),
}));
vi.mock('../../../../../lib/delivery/details', () => ({
  validateListingDetails: (...a: unknown[]) => mockValidateListingDetails(...a),
}));
vi.mock('../../../../../lib/delivery/variants', () => ({
  regenerateVariant: (...a: unknown[]) => mockRegenerateVariant(...a),
}));
vi.mock('../../../../../lib/delivery/voiceover-script', () => ({
  generateDeliveryScript: (...a: unknown[]) => mockGenerateDeliveryScript(...a),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => ({
    from: (...a: unknown[]) => mockDbFrom(...a),
  }),
}));

import handler from '../[runId]';

function makeRes() {
  return {
    _status: 0, _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}
const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };
const run = { id: 'r1', property_id: 'p1', stage: 'checkpoint_a' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
  mockGetRun.mockResolvedValue(run);
  mockGetVariantsForRun.mockResolvedValue([]);
  mockGetEventsForRun.mockResolvedValue([]);
  mockSetListingDetails.mockResolvedValue({ ...run, listing_details: { price: 899000, source: 'manual' } });
  mockRecordMlEvent.mockResolvedValue(undefined);
  mockValidateListingDetails.mockReturnValue({ ok: true, details: { price: 899000, source: 'manual' } });
  mockRegenerateVariant.mockResolvedValue(undefined);
  mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'Welcome to X St.' });
  mockGenerateDeliveryScript.mockResolvedValue({ script: 'Welcome to X St.', wordCount: 4 });
  // Default chain for supabase (flip_winner update + generate_script address select)
  mockDbSelect.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { address: '470 Sorrento Ct' }, error: null }),
    }),
  });
  mockDbUpdate.mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
  mockDbFrom.mockImplementation((table: string) => {
    if (table === 'properties') return { select: mockDbSelect };
    return { update: mockDbUpdate };
  });
});

describe('GET /api/admin/studio/delivery/[runId]', () => {
  it('GET returns the run bundle', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { run: unknown }).run).toEqual(run);
  });

  it('GET 404s on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'rX' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });
});

describe('POST /api/admin/studio/delivery/[runId]', () => {
  it('POST advance delegates to advanceRun', async () => {
    mockAdvanceRun.mockResolvedValue({ ...run, stage: 'details' });
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'details' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'details');
    expect(res._status).toBe(200);
  });

  it('POST advance surfaces illegal transitions as 400', async () => {
    mockAdvanceRun.mockRejectedValue(new Error('advanceRun: illegal transition checkpoint_a -> music'));
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'music' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('POST advance surfaces stage-moved conflict as 409', async () => {
    mockAdvanceRun.mockRejectedValue(new Error('advanceRun: stage moved (expected judging)'));
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'checkpoint_a' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(409);
  });

  it('POST unknown action -> 400', async () => {
    const res1 = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'nope' } } as unknown as VercelRequest, res1 as unknown as VercelResponse);
    expect(res1._status).toBe(400);
  });

  it('POST reorder -> 200, calls updateRun + recordMlEvent with before/after', async () => {
    mockGetRun.mockResolvedValue({ ...run, scene_order: ['s1', 's2'] });
    mockUpdateRun.mockResolvedValue({ ...run, scene_order: ['s2', 's1'] });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'reorder', scene_order: ['s2', 's1'] } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', { scene_order: ['s2', 's1'] });
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'reorder', { before: ['s1', 's2'], after: ['s2', 's1'] });
  });

  it('POST reorder with wrong id set -> 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, scene_order: ['s1', 's2'] });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'reorder', scene_order: ['s1', 's3'] } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });

  it('POST flip_winner -> 200 and calls recordMlEvent with variant_override', async () => {
    const aVariant = { id: 'va1', scene_id: 's1', variant: 'A', clip_url: 'a.mp4', winner: true, winner_source: 'gemini' };
    const bVariant = { id: 'vb1', scene_id: 's1', variant: 'B', clip_url: 'b.mp4', winner: false, winner_source: 'gemini' };
    mockGetVariantsForRun.mockResolvedValue([aVariant, bVariant]);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'flip_winner', scene_id: 's1' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'variant_override', expect.objectContaining({ scene_id: 's1' }));
  });

  it('POST regenerate -> 200 and calls recordMlEvent with regenerate', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'B' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRegenerateVariant).toHaveBeenCalledWith('r1', 's1', 'B');
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'regenerate', expect.objectContaining({ scene_id: 's1', variant: 'B' }));
  });
});

describe('PATCH /api/admin/studio/delivery/[runId]', () => {
  it('PATCH with valid payload -> 200, calls setListingDetails + recordMlEvent', async () => {
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'r1' }, headers: {}, body: { price: 899000 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockSetListingDetails).toHaveBeenCalledWith('r1', { price: 899000, source: 'manual' });
    expect(mockRecordMlEvent).toHaveBeenCalledWith(
      'r1',
      'details_edit',
      expect.objectContaining({ before: run.listing_details, after: { price: 899000, source: 'manual' } }),
    );
  });

  it('PATCH with invalid payload -> 400', async () => {
    mockValidateListingDetails.mockReturnValue({ ok: false, error: 'price must be a non-negative number' });
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'r1' }, headers: {}, body: { price: -1 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockSetListingDetails).not.toHaveBeenCalled();
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('PATCH with unknown runId -> 404', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'rX' }, headers: {}, body: { price: 899000 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
  });
});

describe('POST generate_script + set_script (T17)', () => {
  it('POST generate_script -> 200, calls generateDeliveryScript + updateRun with script', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_listed', duration_seconds: 30, listing_details: { price: 899000 } });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_script' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockGenerateDeliveryScript).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'r1',
      propertyId: 'p1',
      videoType: 'just_listed',
      durationSec: 30,
    }));
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_script: 'Welcome to X St.' }));
  });

  it('POST generate_script -> 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'generate_script' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockGenerateDeliveryScript).not.toHaveBeenCalled();
  });

  it('POST set_script -> 200, calls updateRun with the new script and records script_edit ml_event', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'Old script.' });
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'New script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: 'New script.' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_script: 'New script.' }));
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'script_edit', { before: 'Old script.', after: 'New script.' });
  });

  it('POST set_script with empty body -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: '' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('POST set_script does NOT record ml_event when script is unchanged', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'Same script.' });
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'Same script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: 'Same script.' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });
});

describe('unsupported methods', () => {
  it('PUT -> 405', async () => {
    const res2 = makeRes();
    await handler({ method: 'PUT', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res2 as unknown as VercelResponse);
    expect(res2._status).toBe(405);
  });
});
