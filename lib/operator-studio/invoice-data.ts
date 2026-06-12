// lib/operator-studio/invoice-data.ts
import { getSupabase } from '../client.js';
import type { InvoiceSummary } from '../types/operator-studio.js';

function firstOfMonth(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function lastOfMonth(d = new Date()): string {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

export async function buildInvoice(opts: { client_id: string; from?: string; to?: string }): Promise<{ summary: InvoiceSummary }> {
  const from = opts.from ?? firstOfMonth();
  const to = opts.to ?? lastOfMonth();

  const db = getSupabase();
  const { data: client, error: cErr } = await db.from('clients').select('id, name, monthly_rate_cents').eq('id', opts.client_id).maybeSingle();
  if (cErr) throw new Error(`buildInvoice: ${cErr.message}`);
  if (!client) throw new Error(`buildInvoice: client ${opts.client_id} not found`);

  const { data: props, error: pErr } = await db
    .from('properties')
    .select('id, address, status, created_at, updated_at')
    .eq('order_mode', 'operator')
    .eq('client_id', opts.client_id)
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`)
    .order('created_at', { ascending: true });
  if (pErr) throw new Error(`buildInvoice: ${pErr.message}`);

  const propIds = (props ?? []).map(p => p.id);
  const costByProp: Record<string, number> = {};
  if (propIds.length > 0) {
    const { data: costs, error: costErr } = await db.from('cost_events').select('property_id, cost_cents').in('property_id', propIds);
    if (costErr) throw new Error(`buildInvoice: ${costErr.message}`);
    for (const c of costs ?? []) costByProp[c.property_id] = (costByProp[c.property_id] ?? 0) + (c.cost_cents ?? 0);
  }

  const line_items = (props ?? []).map(p => ({
    property_id: p.id,
    address: p.address ?? '(no address)',
    delivered_at: p.status === 'complete' ? (p.updated_at?.slice(0, 10) ?? null) : null,
    raw_cost_cents: costByProp[p.id] ?? 0,
  }));

  const summary: InvoiceSummary = {
    client_id: client.id,
    client_name: client.name,
    from, to,
    videos_delivered: line_items.filter(i => i.delivered_at != null).length,
    raw_cost_cents: line_items.reduce((s, i) => s + i.raw_cost_cents, 0),
    contracted_rate_cents: client.monthly_rate_cents,
    line_items,
  };
  return { summary };
}
