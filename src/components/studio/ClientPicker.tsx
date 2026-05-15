import { useEffect, useState } from 'react';

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
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="border rounded px-2 py-1 bg-background text-foreground text-sm w-full"
    >
      {includeNone && <option value="">— No client —</option>}
      {!includeNone && <option value="">— Select client —</option>}
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
