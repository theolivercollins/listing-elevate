import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Pencil, Copy, Check } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { getRelativeTime } from '@/lib/types';
import type { ClientRow } from '@/components/studio/ClientPicker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonthlyRate(cents: number | null): string {
  if (cents == null) return '—';
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

const Clients = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
      setCopiedId(clientId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy invoice summary:', err);
    } finally {
      setCopyingId(null);
    }
  };

  const active = clients.filter((c) => !c.archived_at);
  const archived = clients.filter((c) => c.archived_at);

  // Grid columns definition (mirrored in header and rows)
  const gridColumns = '28px 1.4fr 1fr 1fr 1fr auto';

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · clients</span>
          <h1 className="studio-page-h1">Clients</h1>
          {!loading && (
            <p className="studio-page-sub">
              {active.length} active.{' '}
              {archived.length} archived.
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          <button
            type="button"
            className="studio-cta-primary"
            onClick={() => navigate('/dashboard/studio/clients/new')}
          >
            <Plus size={13} strokeWidth={2} />
            New client
          </button>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Table card ─── */}
      <div className="studio-card" style={{ overflow: 'hidden' }}>
        {/* Header row */}
        <div
          className="studio-table-header-row"
          style={{ gridTemplateColumns: gridColumns }}
        >
          <span className="studio-label" />
          <span className="studio-label">Name</span>
          <span className="studio-label">Email</span>
          <span className="studio-label">Monthly rate</span>
          <span className="studio-label">Last updated</span>
          <span className="studio-label">Actions</span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <Loader2 size={18} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
          </div>
        ) : error ? (
          <div style={{ padding: '24px 18px' }}>
            <div className="studio-error-strip">{error}</div>
          </div>
        ) : clients.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '64px 24px',
              gap: 16,
            }}
          >
            <p style={{ fontSize: 14, color: 'var(--le-muted)', margin: 0 }}>No clients yet.</p>
            <Link to="/dashboard/studio/clients/new" className="studio-cta-primary">
              <Plus size={13} strokeWidth={2} />
              Add the first one
            </Link>
          </div>
        ) : (
          clients.map((client) => (
            <div
              key={client.id}
              className="studio-table-row"
              style={{ gridTemplateColumns: gridColumns }}
            >
              {/* Brand dot */}
              <span
                className="studio-brand-dot"
                style={{ background: client.brand_primary_hex ?? 'rgba(11,11,16,0.12)' }}
                title={client.name}
              />

              {/* Name */}
              <Link
                to={`/dashboard/studio/clients/${client.id}`}
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--le-ink)',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  letterSpacing: '-0.012em',
                }}
              >
                {client.name}
                {client.archived_at && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      fontWeight: 500,
                      color: 'var(--le-muted)',
                      background: 'rgba(11,11,16,0.05)',
                      borderRadius: 99,
                      padding: '1px 6px',
                    }}
                  >
                    archived
                  </span>
                )}
              </Link>

              {/* Email */}
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--le-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {client.contact_email ?? '—'}
              </span>

              {/* Monthly rate */}
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--le-ink-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatMonthlyRate(client.monthly_rate_cents)}
              </span>

              {/* Last updated */}
              <span style={{ fontSize: 12, color: 'var(--le-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {getRelativeTime(client.updated_at)}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link
                  to={`/dashboard/studio/clients/${client.id}`}
                  className="studio-btn-ghost"
                  style={{ fontSize: 11.5, padding: '5px 10px', gap: 5 }}
                  aria-label={`Edit ${client.name}`}
                >
                  <Pencil size={11} strokeWidth={1.6} />
                  Edit
                </Link>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  style={{ fontSize: 11.5, padding: '5px 10px', gap: 5 }}
                  onClick={() => handleCopyInvoice(client.id)}
                  disabled={copyingId === client.id}
                  aria-label={`Copy invoice summary for ${client.name}`}
                >
                  {copyingId === client.id ? (
                    <Loader2 size={11} className="studio-spinner" />
                  ) : copiedId === client.id ? (
                    <Check size={11} strokeWidth={2} style={{ color: 'var(--le-good)' }} />
                  ) : (
                    <Copy size={11} strokeWidth={1.6} />
                  )}
                  {copiedId === client.id ? 'Copied' : 'Invoice'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </StudioShell>
  );
};

export default Clients;
