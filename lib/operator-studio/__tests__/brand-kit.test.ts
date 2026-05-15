import { describe, it, expect } from 'vitest';
import { brandKitFromClient, mergeBrandVars } from '../brand-kit';
import type { ClientRow } from '../../types/operator-studio';

const client: ClientRow = {
  id: 'c1', name: 'Helgemo Team',
  contact_email: null, phone: null, monthly_rate_cents: null, notes: null,
  brand_logo_url: 'https://x/logo.png',
  brand_primary_hex: '#1A1A1A', brand_secondary_hex: '#EEEEEE',
  agent_name: 'Abby Helgemo', agent_headshot_url: 'https://x/abby.png',
  voice_id: null, archived_at: null,
  created_at: '', updated_at: '',
};

describe('brandKitFromClient', () => {
  it('extracts variables from a client row', () => {
    const v = brandKitFromClient(client, { brokerage: 'Helgemo Realty' });
    expect(v).toEqual({
      logo_url: 'https://x/logo.png',
      primary_hex: '#1A1A1A',
      secondary_hex: '#EEEEEE',
      agent_name: 'Abby Helgemo',
      agent_headshot_url: 'https://x/abby.png',
      brokerage: 'Helgemo Realty',
    });
  });

  it('returns nulls for missing fields', () => {
    const v = brandKitFromClient({ ...client, brand_logo_url: null, agent_headshot_url: null }, {});
    expect(v.logo_url).toBeNull();
    expect(v.agent_headshot_url).toBeNull();
    expect(v.brokerage).toBeNull();
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

  it('is a no-op when brand vars are all null', () => {
    const empty = { logo_url: null, primary_hex: null, secondary_hex: null, agent_name: null, agent_headshot_url: null, brokerage: null };
    expect(mergeBrandVars({ 'Music.source': 'foo.mp3' }, empty)).toEqual({ 'Music.source': 'foo.mp3' });
  });
});
