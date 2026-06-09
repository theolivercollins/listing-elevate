import { describe, it, expect } from 'vitest';
import { brandKitFromClient, mergeBrandVars } from '../brand-kit';
import type { ClientRow } from '../../types/operator-studio';

const client: ClientRow = {
  id: 'c1', name: 'Helgemo Team',
  contact_email: null, phone: '9412059011', monthly_rate_cents: null, notes: null,
  brand_logo_url: 'https://x/logo.png',
  brand_primary_hex: '#1A1A1A', brand_secondary_hex: '#EEEEEE',
  agent_name: 'Abby Helgemo', agent_headshot_url: 'https://x/abby.png',
  voice_id: null, brokerage: null, archived_at: null,
  created_at: '', updated_at: '',
};

describe('brandKitFromClient', () => {
  it('extracts variables from a client row, including formatted phone', () => {
    const v = brandKitFromClient(client, { brokerage: 'Helgemo Realty' });
    expect(v).toEqual({
      logo_url: 'https://x/logo.png',
      primary_hex: '#1A1A1A',
      secondary_hex: '#EEEEEE',
      agent_name: 'Abby Helgemo',
      agent_headshot_url: 'https://x/abby.png',
      brokerage: 'Helgemo Realty',
      phone: '(941) 205-9011',
    });
  });

  it('returns nulls for missing fields', () => {
    const v = brandKitFromClient({ ...client, brand_logo_url: null, agent_headshot_url: null, phone: null }, {});
    expect(v.logo_url).toBeNull();
    expect(v.agent_headshot_url).toBeNull();
    expect(v.brokerage).toBeNull();
    expect(v.phone).toBeNull();
  });
});

describe('mergeBrandVars', () => {
  it('merges into Creatomate modifications, preserving non-brand keys', () => {
    const out = mergeBrandVars({ 'Music.source': 'foo.mp3' }, brandKitFromClient(client, { brokerage: 'Helgemo Realty' }));
    expect(out['Music.source']).toBe('foo.mp3');
    expect(out['Brand.logo']).toBe('https://x/logo.png');
    expect(out['Brand.primary']).toBe('#1A1A1A');
    expect(out['Brand.agent_name']).toBe('Abby Helgemo');
  });

  it('feeds the client headshot to BOTH Brand.agent_headshot and the 15s template Image-Headshot', () => {
    const out = mergeBrandVars({}, brandKitFromClient(client, { brokerage: 'Helgemo Realty' }));
    expect(out['Brand.agent_headshot']).toBe('https://x/abby.png');
    expect(out['Image-Headshot.source']).toBe('https://x/abby.png');
  });

  it('feeds the client phone to BOTH Brand.phone and Text-Phone-Number (overrides operator profile phone)', () => {
    // base already has the operator's profile phone; client phone must win for client listings
    const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator-phone' }, brandKitFromClient(client, {}));
    expect(out['Brand.phone']).toBe('(941) 205-9011');
    expect(out['Text-Phone-Number.text']).toBe('(941) 205-9011');
  });

  it('also feeds the client brokerage/agent name to the 15s template Text-* keys', () => {
    const out = mergeBrandVars({}, brandKitFromClient(client, { brokerage: 'Helgemo Realty' }));
    expect(out['Text-Brokerage-Team.text']).toBe('Helgemo Realty');
    expect(out['Text-Agent-Name.text']).toBe('Abby Helgemo');
  });

  it('does not set Image-Headshot / Text-Phone-Number when the client lacks them', () => {
    const out = mergeBrandVars({}, brandKitFromClient({ ...client, agent_headshot_url: null, phone: null }, {}));
    expect(out).not.toHaveProperty('Image-Headshot.source');
    expect(out).not.toHaveProperty('Text-Phone-Number.text');
  });

  it('is a no-op when brand vars are all null', () => {
    const empty = { logo_url: null, primary_hex: null, secondary_hex: null, agent_name: null, agent_headshot_url: null, brokerage: null, phone: null };
    expect(mergeBrandVars({ 'Music.source': 'foo.mp3' }, empty)).toEqual({ 'Music.source': 'foo.mp3' });
  });
});

// ── New tests for brokerage precedence and Brand.phone injection ──────────────

const baseClient: ClientRow = {
  id: 'c1', name: 'Helgemo Team', contact_email: null, phone: '9412059011',
  monthly_rate_cents: null, notes: null, brand_logo_url: 'https://x/logo.png',
  brand_primary_hex: '#112233', brand_secondary_hex: null,
  agent_name: 'Brian Helgemo', agent_headshot_url: 'https://x/head.jpg',
  voice_id: null, brokerage: 'RE/MAX Harbor Realty', archived_at: null,
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('brandKitFromClient — brokerage precedence', () => {
  it('prefers clients.brokerage over the property brokerage', () => {
    const kit = brandKitFromClient(baseClient, { brokerage: 'Property Brokerage LLC' });
    expect(kit.brokerage).toBe('RE/MAX Harbor Realty');
  });
  it('falls back to properties.brokerage when client has none', () => {
    const kit = brandKitFromClient({ ...baseClient, brokerage: null }, { brokerage: 'Property Brokerage LLC' });
    expect(kit.brokerage).toBe('Property Brokerage LLC');
  });
  it('formats phone for display', () => {
    const kit = brandKitFromClient(baseClient, { brokerage: null });
    expect(kit.phone).toBe('(941) 205-9011');
  });
});

describe('mergeBrandVars — Brand.phone injection', () => {
  it('writes Brand.phone AND Text-Phone-Number.text', () => {
    const kit = brandKitFromClient(baseClient, { brokerage: null });
    const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator phone' }, kit);
    expect(out['Brand.phone']).toBe('(941) 205-9011');
    expect(out['Text-Phone-Number.text']).toBe('(941) 205-9011'); // client wins over operator-derived base
  });
  it('null brand values do NOT clobber base keys', () => {
    const kit = brandKitFromClient({ ...baseClient, phone: null }, { brokerage: null });
    const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator phone' }, kit);
    expect(out['Text-Phone-Number.text']).toBe('operator phone');
  });
});
