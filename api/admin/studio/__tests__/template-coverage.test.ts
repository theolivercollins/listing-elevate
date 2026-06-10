import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetTemplate = vi.fn();

vi.mock('../../../../lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock('../../../../lib/providers/creatomate', () => ({
  CreatomateProvider: class {
    getTemplate(id: string) { return mockGetTemplate(id); }
  },
}));

import handler from '../template-coverage';

function makeRes() {
  return {
    _status: 0, _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}
const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetTemplate.mockReset();
  process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = 'tpl-15';
  delete process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED;
  delete process.env.CREATOMATE_TEMPLATE_ID_JUST_PENDED;
  delete process.env.CREATOMATE_TEMPLATE_ID_JUST_CLOSED;
  delete process.env.CREATOMATE_TEMPLATE_ID_LIFE_CYCLE;
  delete process.env.CREATOMATE_TEMPLATE_ID_DEFAULT;
});

describe('GET /api/admin/studio/template-coverage', () => {
  it('returns per-template dynamic field lists for configured env template ids', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetTemplate.mockResolvedValue({
      name: '15 seconds - Just Listed', width: 1280, height: 720,
      elements: [
        { name: 'Text-Phone-Number', type: 'text', dynamic: ['text'] },
        { name: 'Image-Headshot', type: 'image', dynamic: ['source'] },
        { name: 'Static-BG', type: 'shape', dynamic: [] },
      ],
    });
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { templates: Array<{ env_var: string; template_id: string; name: string; fields: string[] }> };
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].env_var).toBe('CREATOMATE_TEMPLATE_ID_JUST_LISTED_15');
    expect(body.templates[0].fields).toEqual(['Text-Phone-Number.text', 'Image-Headshot.source']);
  });

  it('reports a fetch failure per-template instead of 500ing the whole panel', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetTemplate.mockRejectedValue(new Error('Creatomate template fetch failed: 404'));
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { templates: Array<{ error?: string }> };
    expect(body.templates[0].error).toMatch(/404/);
  });

  it('returns 405 for non-GET requests', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(405);
  });

  it('returns null (auth failed) when requireAdmin returns null', async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it('returns empty templates array when no env vars are set', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    // Clear the one set in beforeEach
    delete process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15;
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { templates: unknown[] };
    expect(body.templates).toHaveLength(0);
  });
});
