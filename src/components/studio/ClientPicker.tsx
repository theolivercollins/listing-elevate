import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/api';

export interface ClientRow {
  id: string;
  name: string;
  contact_email: string | null;
  phone: string | null;
  monthly_rate_cents: number | null;
  notes: string | null;
  brand_logo_url: string | null;
  brand_primary_hex: string | null;
  brand_secondary_hex: string | null;
  agent_name: string | null;
  agent_headshot_url: string | null;
  voice_id: string | null;
  brokerage: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * ClientPicker — styled select for picking a client.
 * Rendered inside .studio-scope so design tokens resolve.
 * Preserves existing logic (fetch /api/admin/studio/clients) and interface.
 */
export function ClientPicker({
  value,
  onChange,
  includeNone = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  includeNone?: boolean;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authedFetch('/api/admin/studio/clients');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      }
      const d = await res.json();
      setClients(d.clients ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load clients');
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadClients(); }, [loadClients]);

  return (
    <>
    <div style={{ position: 'relative' }}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
          width: '100%',
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'var(--le-surface)',
          border: '1px solid var(--le-line)',
          borderRadius: 'var(--le-radius-sm)',
          padding: '10px 36px 10px 12px',
          fontSize: 13.5,
          fontFamily: 'inherit',
          color: value ? 'var(--le-ink)' : 'var(--le-muted-2)',
          outline: 'none',
          cursor: 'pointer',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(11,11,16,0.16)';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(11,11,16,0.04)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--le-line)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {loading && <option value="">Loading clients…</option>}
        {!loading && includeNone && <option value="">No client</option>}
        {!loading && !includeNone && <option value="">Select client</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--le-muted)',
          pointerEvents: 'none',
        }}
      />
    </div>
    {loadError && (
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--le-bad, #b42318)' }}>
          Couldn't load clients: {loadError}
        </span>
        <button
          type="button"
          className="studio-btn-ghost"
          style={{ fontSize: 11.5, padding: '2px 8px' }}
          onClick={() => void loadClients()}
        >
          <RefreshCw size={11} strokeWidth={1.8} /> Retry
        </button>
      </div>
    )}
    </>
  );
}
