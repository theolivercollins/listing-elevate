import { useState, useEffect, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Pencil, Copy } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { getRelativeTime } from '@/lib/types';
import type { ClientRow } from '@/components/studio/ClientPicker';
import '@/v2/styles/v2.css';

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const PAGE_H1: CSSProperties = {
  fontFamily: 'var(--le-font-sans)',
  fontSize: 'clamp(28px, 4vw, 44px)',
  fontWeight: 500,
  letterSpacing: '-0.035em',
  lineHeight: 0.98,
  color: '#fff',
  margin: 0,
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(220,230,255,0.18)',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'var(--le-font-sans)',
};

const ACCENT_BTN: CSSProperties = {
  ...GHOST_BTN,
  background: 'var(--le-accent)',
  color: 'var(--le-accent-fg)',
  border: 'none',
};

function formatMonthlyRate(cents: number | null): string {
  if (cents == null) return '—';
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

const Clients = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/studio/clients');
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!cancelled) {
          setClients(data.clients ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clients');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleCopyInvoice = async (clientId: string) => {
    setCopyingId(clientId);
    try {
      const res = await fetch('/api/admin/studio/invoice-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      await navigator.clipboard.writeText(data.text ?? '');
    } catch (err) {
      console.error('Failed to copy invoice summary:', err);
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— Clients</span>
          <h2 className="mt-3" style={PAGE_H1}>
            Clients
          </h2>
        </div>
        <button
          type="button"
          style={ACCENT_BTN}
          onClick={() => navigate('/dashboard/studio/clients/new')}
        >
          <Plus style={{ width: 14, height: 14 }} /> New Client
        </button>
      </div>

      <StudioNav />

      {/* Table */}
      <div className="border-t border-border">
        {/* Column headers */}
        <div
          className="grid gap-4 border-b border-border py-3"
          style={{
            gridTemplateColumns: '28px 2fr 1.6fr 1fr 1fr 1fr auto',
            background: 'rgba(255,255,255,0.03)',
          }}
        >
          <span style={EYEBROW} />
          <span style={EYEBROW}>Name</span>
          <span style={EYEBROW}>Email</span>
          <span className="text-right" style={EYEBROW}>Monthly rate</span>
          {/* TODO: # active listings — requires a join against the queue endpoint */}
          <span className="text-right" style={EYEBROW}>Listings</span>
          <span style={EYEBROW}>Updated</span>
          <span style={EYEBROW}>Actions</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-20 text-center text-sm text-destructive">{error}</div>
        ) : clients.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            No clients yet.{' '}
            <Link to="/dashboard/studio/clients/new" className="underline underline-offset-4">
              Add the first one.
            </Link>
          </div>
        ) : (
          clients.map((client) => (
            <div
              key={client.id}
              className="grid items-center gap-4 border-b border-border py-4 transition-colors hover:bg-secondary/30"
              style={{
                gridTemplateColumns: '28px 2fr 1.6fr 1fr 1fr 1fr auto',
              }}
            >
              {/* Brand color dot */}
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: client.brand_primary_hex ?? 'rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />

              {/* Name */}
              <Link
                to={`/dashboard/studio/clients/${client.id}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {client.name}
              </Link>

              {/* Email */}
              <span className="truncate text-xs text-muted-foreground">
                {client.contact_email ?? '—'}
              </span>

              {/* Monthly rate */}
              <span className="tabular text-right text-sm">
                {formatMonthlyRate(client.monthly_rate_cents)}
              </span>

              {/* # active listings — TODO: compute via queue endpoint join */}
              <span className="tabular text-right text-xs text-muted-foreground">—</span>

              {/* Last updated */}
              <span className="tabular text-xs text-muted-foreground">
                {getRelativeTime(client.updated_at)}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Link
                  to={`/dashboard/studio/clients/${client.id}`}
                  style={{ ...GHOST_BTN, padding: '5px 10px', fontSize: 11 }}
                  aria-label={`Edit ${client.name}`}
                >
                  <Pencil style={{ width: 12, height: 12 }} /> Edit
                </Link>
                <button
                  type="button"
                  style={{ ...GHOST_BTN, padding: '5px 10px', fontSize: 11 }}
                  onClick={() => handleCopyInvoice(client.id)}
                  disabled={copyingId === client.id}
                  aria-label={`Copy invoice summary for ${client.name}`}
                >
                  {copyingId === client.id ? (
                    <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Copy style={{ width: 12, height: 12 }} />
                  )}{' '}
                  Invoice
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Clients;
