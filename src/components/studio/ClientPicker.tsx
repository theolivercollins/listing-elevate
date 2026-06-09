import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

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

  useEffect(() => {
    fetch('/api/admin/studio/clients')
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []));
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="studio-input"
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 36,
          color: value ? 'var(--le-ink)' : 'var(--le-muted-2)',
          cursor: 'pointer',
        }}
      >
        {includeNone && <option value="">No client</option>}
        {!includeNone && <option value="">Select client</option>}
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
  );
}
