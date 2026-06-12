import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports of the module under test
// ---------------------------------------------------------------------------

const mockIsWellFormedToken = vi.fn();
const mockFetchByToken = vi.fn();
const mockLookupPreviewId = vi.fn();
const mockInsertViewEvent = vi.fn();

vi.mock('../../../lib/operator-studio/preview-tokens', () => ({
  isWellFormedToken: (t: string) => mockIsWellFormedToken(t),
}));
vi.mock('../../../lib/operator-studio/preview', () => ({
  fetchByToken: (t: string) => mockFetchByToken(t),
  lookupPreviewId: (t: string) => mockLookupPreviewId(t),
  insertViewEvent: (args: unknown) => mockInsertViewEvent(args),
}));

import handler from '../[token]/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    _status: 0,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    /** Vercel serverless returns 204 via .status(204).end() */
    end() { return this; },
  };
  return res;
}

const VALID_TOKEN = 'validtoken1234567890validtoken12';

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    query: { token: VALID_TOKEN },
    body: { session_id: 'sess-abc', event: 'play' },
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer: 'https://example.com/preview',
    },
    ...overrides,
  } as unknown as VercelRequest;
}

/** A standard active preview link (not expired, not revoked). */
function makeActiveResult() {
  return {
    expired: false,
    property: { id: 'prop-1', address: '5 Elm, City, FL 33950, USA', horizontal_video_url: 'h.mp4', vertical_video_url: null, client_id: null },
    client: null,
    preview: { kind: 'client', allow_download: true, allow_approve: true, allow_revision: true, approved_at: null },
    hero_photo_url: null,
  };
}

beforeEach(() => {
  mockIsWellFormedToken.mockReset();
  mockFetchByToken.mockReset();
  mockLookupPreviewId.mockReset();
  mockInsertViewEvent.mockReset();

  // Default happy path: valid token, active link, preview id known, insert succeeds
  mockIsWellFormedToken.mockReturnValue(true);
  mockFetchByToken.mockResolvedValue(makeActiveResult());
  mockLookupPreviewId.mockResolvedValue('preview-uuid-1234');
  mockInsertViewEvent.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Non-POST → 405
// ---------------------------------------------------------------------------

describe('non-POST methods → 405', () => {
  it('returns 405 for GET', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Token validation → 404
// ---------------------------------------------------------------------------

describe('malformed token → 404', () => {
  it('returns 404 and does not call fetchByToken for a bad token', async () => {
    mockIsWellFormedToken.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq({ query: { token: 'bad!' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockFetchByToken).not.toHaveBeenCalled();
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Link existence / expiry / revocation → 404
// ---------------------------------------------------------------------------

describe('missing or expired/revoked link → 404', () => {
  it('returns 404 when fetchByToken returns null (link not found)', async () => {
    mockFetchByToken.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 404 when link is expired', async () => {
    mockFetchByToken.mockResolvedValue({ ...makeActiveResult(), expired: true });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 404 when link is revoked (expired===true because fetchByToken sets it)', async () => {
    // fetchByToken sets expired=true when revoked_at is present; same guard applies
    mockFetchByToken.mockResolvedValue({ ...makeActiveResult(), expired: true });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(404);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// session_id validation → 400
// ---------------------------------------------------------------------------

describe('missing or empty session_id → 400', () => {
  it('returns 400 when session_id is absent from body', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { event: 'play' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when session_id is an empty string', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: '', event: 'play' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when session_id is whitespace-only', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: '   ', event: 'play' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// event whitelist → 400
// ---------------------------------------------------------------------------

describe('invalid event → 400', () => {
  it('returns 400 for an unknown event name', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'skip' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when event is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });

  it('returns 400 for empty event string', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: '' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// orientation whitelist → 400 when present but invalid
// ---------------------------------------------------------------------------

describe('invalid orientation → 400', () => {
  it('returns 400 when orientation is provided but not horizontal|vertical', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'play', orientation: 'square' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(400);
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path — valid insert → 204
// ---------------------------------------------------------------------------

describe('valid POST → 204', () => {
  it('returns 204 for a well-formed play event', async () => {
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('calls insertViewEvent with correct arguments', async () => {
    const res = makeRes();
    await handler(
      makeReq({
        body: { session_id: 'sess-xyz', event: 'progress_50', position_seconds: 30.5, orientation: 'horizontal' },
        headers: { 'user-agent': 'TestAgent/1.0', referer: 'https://example.com' },
      }),
      res as unknown as VercelResponse,
    );
    expect(mockInsertViewEvent).toHaveBeenCalledWith({
      preview_id: 'preview-uuid-1234',
      session_id: 'sess-xyz',
      event: 'progress_50',
      position_seconds: 30.5,
      orientation: 'horizontal',
      user_agent: 'TestAgent/1.0',
      referrer: 'https://example.com',
    });
    expect(res._status).toBe(204);
  });

  it.each([
    'view', 'play', 'progress_25', 'progress_50', 'progress_75', 'complete',
  ] as const)('accepts event=%s', async (event) => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event } }), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('accepts horizontal orientation', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'play', orientation: 'horizontal' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('accepts vertical orientation', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'play', orientation: 'vertical' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('accepts omitted orientation (passes null to insertViewEvent)', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'play' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
    const call = mockInsertViewEvent.mock.calls[0][0] as { orientation: unknown };
    expect(call.orientation).toBeNull();
  });

  it('omits position_seconds when not provided', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { session_id: 'sess-abc', event: 'view' } }), res as unknown as VercelResponse);
    const call = mockInsertViewEvent.mock.calls[0][0] as { position_seconds: unknown };
    expect(call.position_seconds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pre-migration insert failure → still 204 (never break the watch page)
// ---------------------------------------------------------------------------

describe('pre-migration insert failure → 204', () => {
  it('returns 204 even when insertViewEvent swallows an error (pre-migration)', async () => {
    // insertViewEvent always returns void — it swallows errors internally.
    // Simulate that behaviour: resolved with undefined (same as real swallow path).
    mockInsertViewEvent.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
  });

  it('returns 204 when lookupPreviewId returns null (preview_view_events table absent pre-migration)', async () => {
    // If the table doesn't exist and lookupPreviewId swallows the error, it returns null.
    // The endpoint should still 204 rather than error.
    mockLookupPreviewId.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
    // insertViewEvent should NOT be called when we have no preview_id to reference
    expect(mockInsertViewEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UA and referrer clamping to 512 chars
// ---------------------------------------------------------------------------

describe('UA and referrer clamping to 512 chars', () => {
  it('clamps user-agent longer than 512 chars to exactly 512', async () => {
    const longUA = 'A'.repeat(600);
    const res = makeRes();
    await handler(
      makeReq({ headers: { 'user-agent': longUA, referer: 'https://x.com' } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(204);
    const call = mockInsertViewEvent.mock.calls[0][0] as { user_agent: string };
    expect(call.user_agent).toHaveLength(512);
    expect(call.user_agent).toBe('A'.repeat(512));
  });

  it('clamps referrer longer than 512 chars to exactly 512', async () => {
    const longRef = 'https://' + 'b'.repeat(600);
    const res = makeRes();
    await handler(
      makeReq({ headers: { 'user-agent': 'UA/1.0', referer: longRef } }),
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(204);
    const call = mockInsertViewEvent.mock.calls[0][0] as { referrer: string };
    expect(call.referrer).toHaveLength(512);
  });

  it('passes through UA and referrer that are 512 chars or shorter unchanged', async () => {
    const ua = 'B'.repeat(512);
    const ref = 'C'.repeat(512);
    const res = makeRes();
    await handler(
      makeReq({ headers: { 'user-agent': ua, referer: ref } }),
      res as unknown as VercelResponse,
    );
    const call = mockInsertViewEvent.mock.calls[0][0] as { user_agent: string; referrer: string };
    expect(call.user_agent).toBe(ua);
    expect(call.referrer).toBe(ref);
  });

  it('passes null for missing UA header', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res as unknown as VercelResponse);
    const call = mockInsertViewEvent.mock.calls[0][0] as { user_agent: unknown };
    expect(call.user_agent).toBeNull();
  });

  it('passes null for missing referer header', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { 'user-agent': 'UA/1.0' } }), res as unknown as VercelResponse);
    const call = mockInsertViewEvent.mock.calls[0][0] as { referrer: unknown };
    expect(call.referrer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// session_id clamping to 200 chars
// ---------------------------------------------------------------------------

describe('session_id clamping to 200 chars', () => {
  it('clamps session_id longer than 200 chars to exactly 200', async () => {
    const longSess = 's'.repeat(300);
    const res = makeRes();
    await handler(makeReq({ body: { session_id: longSess, event: 'play' } }), res as unknown as VercelResponse);
    expect(res._status).toBe(204);
    const call = mockInsertViewEvent.mock.calls[0][0] as { session_id: string };
    expect(call.session_id).toHaveLength(200);
  });
});
