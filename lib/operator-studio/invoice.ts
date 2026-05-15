// lib/operator-studio/invoice.ts
import type { InvoiceSummary } from '../types/operator-studio';

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function formatInvoiceSummary(s: InvoiceSummary): string {
  const lines: string[] = [];
  lines.push(`CLIENT: ${s.client_name}`);
  lines.push(`PERIOD: ${s.from} to ${s.to}`);
  lines.push(`VIDEOS DELIVERED: ${s.videos_delivered}`);
  for (const item of s.line_items) {
    const when = item.delivered_at ? `delivered ${item.delivered_at}` : 'pending';
    lines.push(`  - ${item.address} (${when})`);
  }
  lines.push(`RAW COST: ${dollars(s.raw_cost_cents)}`);
  if (s.contracted_rate_cents != null) lines.push(`CONTRACTED RATE: ${dollars(s.contracted_rate_cents)}`);
  return lines.join('\n');
}
