import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Pencil, Copy, Check, Search } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { getRelativeTime } from '@/lib/types';
import type { ClientRow } from '@/components/studio/ClientPicker';
import { authedFetch } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonthlyRate(cents: number | null): string {
  if (cents == null) return '—';
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

/** Derive a 1–2 char initial from client name */
function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/** Derive a consistent hue for the avatar background */
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return 200 + (h % 160);
}

// ─── Main component ────────────────────────────────────────────────────────────

const Clients = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authedFetch('/api/admin/studio/clients');
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
      const res = await authedFetch('/api/admin/studio/invoice-summary', {
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

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contact_email ?? '').toLowerCase().includes(q),
    );
  }, [clients, search]);

  // Grid columns definition (mirrored in header and rows)
  // avatar | name | email | monthly rate | last updated | actions
  const gridColumns = '40px 1.4fr 1fr 1fr 1fr auto';

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
              {archived.length > 0 && `${archived.length} archived.`}
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={13}
              strokeWidth={1.8}
              style={{
                position: 'absolute',
                left: 11,
                color: 'var(--le-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              className="studio-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients…"
              style={{ paddingLeft: 30, width: 200, height: 38 }}
            />
          </div>
          <button
            type="button"
            className="studio-cta-primary"
            onClick={() => navigate('/dashboard/studio/video/clients/new')}
          >
            <Plus size={13} strokeWidth={2} />
            Add client
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
          <span className="studio-label" style={{ textAlign: 'right' }}>Actions</span>
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
            <Link to="/dashboard/studio/video/clients/new" className="studio-cta-primary">
              <Plus size={13} strokeWidth={2} />
              Add the first one
            </Link>
          </div>
        ) : filteredClients.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13, color: 'var(--le-muted)' }}>
            No clients match &ldquo;{search}&rdquo;.
          </div>
        ) : (
          filteredClients.map((client) => {
            const hue = avatarHue(client.name);
            const initials = clientInitials(client.name);
            return (
              <div
                key={client.id}
                className="studio-table-row"
                style={{ gridTemplateColumns: gridColumns, cursor: 'pointer' }}
                onClick={() => navigate(`/dashboard/studio/video/clients/${client.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') navigate(`/dashboard/studio/video/clients/${client.id}`);
                }}
              >
                {/* Avatar / initial */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: client.brand_primary_hex
                      ? client.brand_primary_hex
                      : `linear-gradient(135deg, hsl(${hue},14%,58%), hsl(${hue + 30},14%,44%))`,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                  title={client.name}
                >
                  {initials}
                </div>

                {/* Name */}
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'var(--le-ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    letterSpacing: '-0.012em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {client.name}
                  {client.archived_at && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: 'var(--le-muted)',
                        background: 'rgba(11,11,16,0.05)',
                        borderRadius: 99,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}
                    >
                      archived
                    </span>
                  )}
                </span>

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

                {/* Actions — stop propagation so row click doesn't fire */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <Link
                    to={`/dashboard/studio/video/clients/${client.id}`}
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
            );
          })
        )}
      </div>
    </StudioShell>
  );
};

export default Clients;
