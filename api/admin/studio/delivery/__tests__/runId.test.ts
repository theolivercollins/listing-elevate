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

describe('unsupported methods', () => {
  it('PUT -> 405', async () => {
    const res2 = makeRes();
    await handler({ method: 'PUT', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res2 as unknown as VercelResponse);
    expect(res2._status).toBe(405);
  });
});
