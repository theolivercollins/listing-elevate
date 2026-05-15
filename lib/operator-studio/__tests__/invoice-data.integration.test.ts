// lib/operator-studio/__tests__/invoice-data.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSupabase } from '../../client';
import { buildInvoice } from '../invoice-data';

const RUN = process.env.LE_RUN_INTEGRATION === 'true';
const d = RUN ? describe : describe.skip;

d('buildInvoice (integration)', () => {
  const clientName = `__test_client_${Date.now()}`;
  let clientId: string;
  let inRangePropId: string;
  let outOfRangePropId: string;

  beforeAll(async () => {
    const db = getSupabase();
    const { data: c } = await db.from('clients').insert({ name: clientName, monthly_rate_cents: 50000 }).select('id').single();
    clientId = c!.id;

    const { data: pIn } = await db.from('properties').insert({
      order_mode: 'operator', client_id: clientId, address: '1 Oak St',
      status: 'complete', created_at: '2026-05-10T12:00:00Z',
    }).select('id').single();
    inRangePropId = pIn!.id;
    await db.from('cost_events').insert([
      { property_id: inRangePropId, stage: 'analysis', provider: 'anthropic', cost_cents: 200, unit_type: 'tokens', units_consumed: 1 },
      { property_id: inRangePropId, stage: 'assembly', provider: 'creatomate', cost_cents: 400, unit_type: 'renders', units_consumed: 1 },
    ]);

    const { data: pOut } = await db.from('properties').insert({
      order_mode: 'operator', client_id: clientId, address: '99 Far St',
      status: 'complete', created_at: '2026-04-10T12:00:00Z',
    }).select('id').single();
    outOfRangePropId = pOut!.id;
    await db.from('cost_events').insert([{ property_id: outOfRangePropId, stage: 'assembly', provider: 'creatomate', cost_cents: 999, unit_type: 'renders', units_consumed: 1 }]);
  });

  afterAll(async () => {
    const db = getSupabase();
    await db.from('properties').delete().eq('client_id', clientId);
    await db.from('clients').delete().eq('id', clientId);
  });

  it('aggregates only properties created in the date range', async () => {
    const { summary } = await buildInvoice({ client_id: clientId, from: '2026-05-01', to: '2026-05-31' });
    expect(summary.videos_delivered).toBe(1);
    expect(summary.raw_cost_cents).toBe(600);
    expect(summary.line_items).toHaveLength(1);
    expect(summary.line_items[0].address).toBe('1 Oak St');
    expect(summary.contracted_rate_cents).toBe(50000);
  });

  it('defaults to current calendar month when no dates provided', async () => {
    const { summary } = await buildInvoice({ client_id: clientId });
    expect(summary.from).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
