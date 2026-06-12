// lib/operator-studio/__tests__/invoice.test.ts
import { describe, it, expect } from 'vitest';
import { formatInvoiceSummary } from '../invoice';
import type { InvoiceSummary } from '../../types/operator-studio';

describe('formatInvoiceSummary', () => {
  const base: InvoiceSummary = {
    client_id: 'c1', client_name: 'Helgemo Team',
    from: '2026-05-01', to: '2026-05-31',
    videos_delivered: 2, raw_cost_cents: 1234, contracted_rate_cents: 50000,
    line_items: [
      { property_id: 'p1', address: '123 Oak St', delivered_at: '2026-05-10', raw_cost_cents: 600 },
      { property_id: 'p2', address: '456 Pine Ave', delivered_at: '2026-05-22', raw_cost_cents: 634 },
    ],
  };

  it('formats a paste-ready block', () => {
    const out = formatInvoiceSummary(base);
    expect(out).toContain('CLIENT: Helgemo Team');
    expect(out).toContain('PERIOD: 2026-05-01 to 2026-05-31');
    expect(out).toContain('VIDEOS DELIVERED: 2');
    expect(out).toContain('  - 123 Oak St (delivered 2026-05-10)');
    expect(out).toContain('  - 456 Pine Ave (delivered 2026-05-22)');
    expect(out).toContain('RAW COST: $12.34');
    expect(out).toContain('CONTRACTED RATE: $500.00');
  });

  it('omits CONTRACTED RATE line when null', () => {
    const out = formatInvoiceSummary({ ...base, contracted_rate_cents: null });
    expect(out).not.toContain('CONTRACTED RATE');
  });

  it('renders undelivered as "(pending)"', () => {
    const out = formatInvoiceSummary({ ...base, videos_delivered: 0, line_items: [{ property_id: 'p3', address: '789 Elm', delivered_at: null, raw_cost_cents: 0 }] });
    expect(out).toContain('  - 789 Elm (pending)');
  });
});
