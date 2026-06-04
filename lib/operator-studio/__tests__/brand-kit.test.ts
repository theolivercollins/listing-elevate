import { describe, it, expect } from 'vitest';
import { brandKitFromClient, mergeBrandVars } from '../brand-kit';
import type { ClientRow } from '../../types/operator-studio';

const client: ClientRow = {
  id: 'c1', name: 'Helgemo Team',
  contact_email: null, phone: 'c: 941.205.9011', monthly_rate_cents: null, notes: null,
  brand_logo_url: 'https://x/logo.png',
  brand_primary_hex: '#1A1A1A', brand_secondary_hex: '#EEEEEE',
  agent_name: 'Abby Helgemo', agent_headshot_url: 'https://x/abby.png',
  voice_id: null, archived_at: null,
  created_at: '', updated_at: '',
};

describe('brandKitFromClient', () => {
  it('extracts variables from a client row, including phone', () => {
    const v = brandKitFromClient(client, { brokerage: 'Helgemo Realty' });
    expect(v).toEqual({
      logo_url: 'https://x/logo.png',
      primary_hex: '#1A1A1A',
      secondary_hex: '#EEEEEE',
      agent_name: 'Abby Helgemo',
      agent_headshot_url: 'https://x/abby.png',
      brokerage: 'Helgemo Realty',
      phone: 'c: 941.205.9011',
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

  it('feeds the client phone to the 15s template Text-Phone-Number (overrides operator profile phone)', () => {
    // base already has the operator's profile phone; client phone must win for client listings
    const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator-phone' }, brandKitFromClient(client, {}));
    expect(out['Text-Phone-Number.text']).toBe('c: 941.205.9011');
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
