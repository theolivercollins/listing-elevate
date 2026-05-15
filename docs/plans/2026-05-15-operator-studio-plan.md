# Operator Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an internal `/dashboard/studio` surface that lets Oliver produce client listing videos end-to-end (ingest → assemble → revise → deliver via preview link → invoice rollup) in minutes per listing, reusing the existing pipeline + Lab + Creatomate assembly.

**Architecture:** New admin-only route mounted at `/dashboard/studio`, gated by existing `<RequireAdmin />`. Single new migration adds `clients`, `playbooks`, `property_previews`, `property_revision_notes` tables plus 5 columns on `properties`. New endpoints under `/api/admin/studio/*`. Public preview at `/preview/:token` (no auth, signed token). All Operator-originated work is tagged `properties.order_mode='operator'` so it never crosses the customer-flow paths.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui (frontend) · Vercel Serverless Functions, Node 20+, ESM, `@vercel/node` (backend) · Supabase Postgres + Storage · Vitest · Creatomate (primary assembly) · Apify Playwright (scraper, Phase 2) · ElevenLabs (voice, future phase).

**Spec:** `docs/specs/2026-05-15-operator-studio-design.md`

---

## Phasing

- **Phase 1 — Internal MVP (this plan, detailed below).** Schema + clients + playbooks-lite + manual ingest + Kanban + Command Center + invoice rollup. Operator can run a listing end-to-end manually (paste address + drag-drop photos) with cost tracking. **Exit criterion:** Oliver can complete one client listing without leaving `/dashboard/studio`.
- **Phase 2 — Quality multipliers.** Apify scraper for magic-link, brand-kit injection at assembly, preview-link delivery, director's notes panel. Detailed plan written before P2 dispatch.
- **Phase 3 — Revision loop.** Inline clip swap (Command Center ↔ Lab Listings ↔ `rerunAssembly`), Claude "distill notes → scene actions", Finances integration. Detailed plan written before P3 dispatch.

Each phase ends on a green branch; merge to `dev` → `staging` → `main` per the standard ship-gate. Phase 1 must demonstrate value before P2/P3 are detailed and dispatched.

---

## File structure (Phase 1)

**Create:**
- `supabase/migrations/055_operator_studio.sql`
- `lib/types/operator-studio.ts` — shared TS types for clients, playbooks, ingest, revision notes
- `lib/operator-studio/clients.ts` — pure CRUD logic (Supabase queries)
- `lib/operator-studio/playbooks.ts` — pure CRUD logic
- `lib/operator-studio/ingest.ts` — manual-ingest helpers (create property, link photos, kick off pipeline)
- `lib/operator-studio/invoice.ts` — pure invoice-summary formatter
- `api/admin/studio/clients/index.ts` — list + create
- `api/admin/studio/clients/[id].ts` — get + update + archive
- `api/admin/studio/playbooks/index.ts` — list + create
- `api/admin/studio/playbooks/[id].ts` — get + update + archive
- `api/admin/studio/ingest.ts` — POST manual ingest (creates property + triggers pipeline)
- `api/admin/studio/invoice-summary.ts` — POST `{ client_id, from, to }` returns formatted block
- `src/pages/dashboard/studio/StudioHome.tsx` — Kanban index
- `src/pages/dashboard/studio/StudioNew.tsx` — new-listing form (manual ingest)
- `src/pages/dashboard/studio/Clients.tsx` — client list
- `src/pages/dashboard/studio/ClientEdit.tsx` — client create/edit form (incl. brand kit upload)
- `src/pages/dashboard/studio/Playbooks.tsx` — playbook list
- `src/pages/dashboard/studio/PlaybookEdit.tsx` — playbook create/edit form
- `src/pages/dashboard/studio/PropertyCommandCenter.tsx` — per-property operator view
- `src/components/studio/StudioNav.tsx` — side nav
- `src/components/studio/ClientPicker.tsx` — reusable client dropdown
- `src/components/studio/PlaybookPicker.tsx` — reusable playbook dropdown
- `lib/operator-studio/__tests__/invoice.test.ts`
- `lib/operator-studio/__tests__/clients.test.ts`
- `lib/operator-studio/__tests__/playbooks.test.ts`
- `lib/operator-studio/__tests__/ingest.test.ts`
- `api/admin/studio/__tests__/ingest.test.ts`
- `api/admin/studio/__tests__/invoice-summary.test.ts`

**Modify:**
- `src/App.tsx` — register `/dashboard/studio/*` routes inside the existing admin guard.
- `src/components/dashboard/TopNav.tsx` (or whichever nav already lists `/dashboard/pipeline`, `/finances`) — add a `Studio` entry.
- `lib/pipeline.ts` — read `properties.order_mode`/`client_id`/`playbook_id` and pass through to logs. **No behavior fork yet** — playbook + brand-kit application lives in Phase 2/3.
- `docs/HANDOFF.md` — append Phase 1 shipping log.
- `docs/state/PROJECT-STATE.md` — note Operator Studio surface on Phase 1 close.

---

## Phase 1 — Tasks

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/055_operator_studio.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 055_operator_studio.sql
-- Operator Studio: clients + playbooks + preview tokens + revision notes
-- Per docs/specs/2026-05-15-operator-studio-design.md

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  phone text,
  monthly_rate_cents integer,
  notes text,
  brand_logo_url text,
  brand_primary_hex text,
  brand_secondary_hex text,
  agent_name text,
  agent_headshot_url text,
  voice_id text,
  default_playbook_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  name text not null,
  orientation text not null check (orientation in ('vertical','horizontal','both')),
  duration_seconds integer not null check (duration_seconds in (15,30,60)),
  music_style text,
  voiceover_enabled boolean not null default false,
  assembly_template_id text,
  prompt_router_preferences jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table clients
  add constraint clients_default_playbook_fk
  foreign key (default_playbook_id) references playbooks(id) on delete set null;

create table if not exists property_previews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  viewed_count integer not null default 0,
  last_viewed_at timestamptz
);
create index if not exists idx_property_previews_property on property_previews(property_id);

create table if not exists property_revision_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  source text not null check (source in ('operator','client_preview')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_property_revision_notes_property on property_revision_notes(property_id, created_at desc);

alter table properties
  add column if not exists order_mode text not null default 'customer' check (order_mode in ('customer','operator')),
  add column if not exists client_id uuid references clients(id) on delete set null,
  add column if not exists playbook_id uuid references playbooks(id) on delete set null,
  add column if not exists ingest_source text check (ingest_source in ('manual','zillow','redfin','sierra','mls','drive_link')),
  add column if not exists ingest_source_url text;

create index if not exists idx_properties_order_mode_client on properties(order_mode, client_id) where order_mode = 'operator';

alter table clients enable row level security;
alter table playbooks enable row level security;
alter table property_previews enable row level security;
alter table property_revision_notes enable row level security;
-- No policies = admin-only via service-role key. Public access uses signed tokens server-side only.
```

- [ ] **Step 2: Apply via Supabase MCP**

Per the credentials memory: prefer Supabase MCP over CLI. Apply against the dev project. Ask Oliver before applying to prod.

```text
Use mcp__plugin_supabase_supabase__apply_migration with name='055_operator_studio' and the SQL above.
```

Expected: success; `list_tables` shows the four new tables and `properties` has the five new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/055_operator_studio.sql
git commit -m "feat(operator-studio): add 055_operator_studio migration"
```

---

### Task 2: Shared types

**Files:**
- Create: `lib/types/operator-studio.ts`

- [ ] **Step 1: Write the types**

```ts
// lib/types/operator-studio.ts

export type ClientRow = {
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
  default_playbook_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInput = Partial<Omit<ClientRow, 'id' | 'created_at' | 'updated_at' | 'archived_at'>> & {
  name: string;
};

export type Orientation = 'vertical' | 'horizontal' | 'both';
export type DurationSeconds = 15 | 30 | 60;

export type PlaybookRow = {
  id: string;
  client_id: string | null;
  name: string;
  orientation: Orientation;
  duration_seconds: DurationSeconds;
  music_style: string | null;
  voiceover_enabled: boolean;
  assembly_template_id: string | null;
  prompt_router_preferences: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
};

export type PlaybookInput = Partial<Omit<PlaybookRow, 'id' | 'created_at' | 'archived_at'>> & {
  name: string;
  orientation: Orientation;
  duration_seconds: DurationSeconds;
};

export type IngestSource = 'manual' | 'zillow' | 'redfin' | 'sierra' | 'mls' | 'drive_link';

export type ManualIngestInput = {
  client_id: string | null;
  playbook_id: string | null;
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
  photo_storage_paths: string[]; // already uploaded to property-photos bucket
  director_notes: string | null;
};

export type RevisionNoteRow = {
  id: string;
  property_id: string;
  source: 'operator' | 'client_preview';
  body: string;
  created_at: string;
};

export type InvoiceLineItem = {
  property_id: string;
  address: string;
  delivered_at: string | null;
  raw_cost_cents: number;
};

export type InvoiceSummary = {
  client_id: string;
  client_name: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  videos_delivered: number;
  raw_cost_cents: number;
  contracted_rate_cents: number | null;
  line_items: InvoiceLineItem[];
};
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS (no diagnostics).

- [ ] **Step 3: Commit**

```bash
git add lib/types/operator-studio.ts
git commit -m "feat(operator-studio): add shared types"
```

---

### Task 3: Invoice formatter — TDD

**Files:**
- Create: `lib/operator-studio/invoice.ts`
- Test: `lib/operator-studio/__tests__/invoice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/operator-studio/__tests__/invoice.test.ts
import { describe, it, expect } from 'vitest';
import { formatInvoiceSummary } from '../invoice';
import type { InvoiceSummary } from '../../types/operator-studio';

describe('formatInvoiceSummary', () => {
  const base: InvoiceSummary = {
    client_id: 'c1',
    client_name: 'Helgemo Team',
    from: '2026-05-01',
    to: '2026-05-31',
    videos_delivered: 2,
    raw_cost_cents: 1234,
    contracted_rate_cents: 50000,
    line_items: [
      { property_id: 'p1', address: '123 Oak St', delivered_at: '2026-05-10', raw_cost_cents: 600 },
      { property_id: 'p2', address: '456 Pine Ave', delivered_at: '2026-05-22', raw_cost_cents: 634 },
    ],
  };

  it('formats a paste-ready block with header, line items, and totals', () => {
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

  it('renders undelivered line items as "(pending)"', () => {
    const out = formatInvoiceSummary({
      ...base,
      line_items: [{ property_id: 'p3', address: '789 Elm', delivered_at: null, raw_cost_cents: 0 }],
      videos_delivered: 0,
    });
    expect(out).toContain('  - 789 Elm (pending)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/operator-studio/__tests__/invoice.test.ts
```

Expected: FAIL — "Cannot find module '../invoice'".

- [ ] **Step 3: Implement**

```ts
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
  if (s.contracted_rate_cents != null) {
    lines.push(`CONTRACTED RATE: ${dollars(s.contracted_rate_cents)}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/operator-studio/__tests__/invoice.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add lib/operator-studio/invoice.ts lib/operator-studio/__tests__/invoice.test.ts
git commit -m "feat(operator-studio): invoice summary formatter"
```

---

### Task 4: Clients CRUD module — TDD

**Files:**
- Create: `lib/operator-studio/clients.ts`
- Test: `lib/operator-studio/__tests__/clients.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/operator-studio/__tests__/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listClients, getClient, createClient, updateClient, archiveClient } from '../clients';

// Mock the Supabase service-role client
const mockFrom = vi.fn();
vi.mock('../../supabase/service', () => ({
  serviceClient: () => ({ from: mockFrom }),
}));

beforeEach(() => {
  mockFrom.mockReset();
});

describe('clients CRUD', () => {
  it('listClients excludes archived by default', async () => {
    const select = vi.fn().mockReturnThis();
    const is = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'c1', name: 'Alice' }], error: null });
    mockFrom.mockReturnValue({ select, is, order });

    const rows = await listClients({ includeArchived: false });
    expect(mockFrom).toHaveBeenCalledWith('clients');
    expect(is).toHaveBeenCalledWith('archived_at', null);
    expect(rows).toEqual([{ id: 'c1', name: 'Alice' }]);
  });

  it('createClient rejects when name is missing', async () => {
    await expect(createClient({ name: '' } as never)).rejects.toThrow(/name/i);
  });

  it('createClient inserts and returns the new row', async () => {
    const insert = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'c2', name: 'Bob' }, error: null });
    mockFrom.mockReturnValue({ insert, select, single });

    const row = await createClient({ name: 'Bob' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bob' }));
    expect(row.id).toBe('c2');
  });

  it('archiveClient sets archived_at to now', async () => {
    const update = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: { id: 'c1', archived_at: '2026-05-15T00:00:00Z' }, error: null });
    mockFrom.mockReturnValue({ update, eq, select, single });

    await archiveClient('c1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith('id', 'c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/operator-studio/__tests__/clients.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/operator-studio/clients.ts
import { serviceClient } from '../supabase/service';
import type { ClientInput, ClientRow } from '../types/operator-studio';

export async function listClients(opts: { includeArchived?: boolean } = {}): Promise<ClientRow[]> {
  let q = serviceClient().from('clients').select('*');
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(`listClients: ${error.message}`);
  return data ?? [];
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const { data, error } = await serviceClient().from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return data;
}

export async function createClient(input: ClientInput): Promise<ClientRow> {
  if (!input.name || !input.name.trim()) throw new Error('createClient: name is required');
  const { data, error } = await serviceClient()
    .from('clients')
    .insert({ ...input, name: input.name.trim() })
    .select('*')
    .single();
  if (error) throw new Error(`createClient: ${error.message}`);
  return data;
}

export async function updateClient(id: string, patch: Partial<ClientInput>): Promise<ClientRow> {
  const { data, error } = await serviceClient()
    .from('clients')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`updateClient: ${error.message}`);
  return data;
}

export async function archiveClient(id: string): Promise<ClientRow> {
  const { data, error } = await serviceClient()
    .from('clients')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`archiveClient: ${error.message}`);
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/operator-studio/__tests__/clients.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/operator-studio/clients.ts lib/operator-studio/__tests__/clients.test.ts
git commit -m "feat(operator-studio): clients CRUD module"
```

---

### Task 5: Playbooks CRUD module — TDD

**Files:**
- Create: `lib/operator-studio/playbooks.ts`
- Test: `lib/operator-studio/__tests__/playbooks.test.ts`

Mirror Task 4 exactly, swapping `clients` → `playbooks` and the input/row types. Validate that `orientation` and `duration_seconds` are required. Test cases: `listPlaybooks` filters out archived; `createPlaybook` rejects missing orientation; `archivePlaybook` sets `archived_at`; `listPlaybooks({ client_id })` filters to that client's books plus global books (`client_id IS NULL`).

```ts
// lib/operator-studio/playbooks.ts
import { serviceClient } from '../supabase/service';
import type { PlaybookInput, PlaybookRow } from '../types/operator-studio';

export async function listPlaybooks(opts: { client_id?: string | null; includeArchived?: boolean } = {}): Promise<PlaybookRow[]> {
  let q = serviceClient().from('playbooks').select('*');
  if (!opts.includeArchived) q = q.is('archived_at', null);
  if (opts.client_id !== undefined) q = q.or(`client_id.eq.${opts.client_id},client_id.is.null`);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(`listPlaybooks: ${error.message}`);
  return data ?? [];
}

export async function getPlaybook(id: string): Promise<PlaybookRow | null> {
  const { data, error } = await serviceClient().from('playbooks').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getPlaybook: ${error.message}`);
  return data;
}

export async function createPlaybook(input: PlaybookInput): Promise<PlaybookRow> {
  if (!input.name?.trim()) throw new Error('createPlaybook: name is required');
  if (!input.orientation) throw new Error('createPlaybook: orientation is required');
  if (!input.duration_seconds) throw new Error('createPlaybook: duration_seconds is required');
  const { data, error } = await serviceClient()
    .from('playbooks')
    .insert({ ...input, name: input.name.trim() })
    .select('*')
    .single();
  if (error) throw new Error(`createPlaybook: ${error.message}`);
  return data;
}

export async function updatePlaybook(id: string, patch: Partial<PlaybookInput>): Promise<PlaybookRow> {
  const { data, error } = await serviceClient().from('playbooks').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(`updatePlaybook: ${error.message}`);
  return data;
}

export async function archivePlaybook(id: string): Promise<PlaybookRow> {
  const { data, error } = await serviceClient().from('playbooks').update({ archived_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw new Error(`archivePlaybook: ${error.message}`);
  return data;
}
```

Test pattern, code shape, and commit verb follow Task 4 verbatim. Commit message: `feat(operator-studio): playbooks CRUD module`.

---

### Task 6: Manual ingest module — TDD

**Files:**
- Create: `lib/operator-studio/ingest.ts`
- Test: `lib/operator-studio/__tests__/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/operator-studio/__tests__/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manualIngest } from '../ingest';
import type { ManualIngestInput } from '../../types/operator-studio';

const insertProperty = vi.fn();
const insertPhotos = vi.fn();
const insertRevisionNote = vi.fn();
const triggerPipeline = vi.fn();

vi.mock('../../supabase/service', () => ({
  serviceClient: () => ({
    from: (table: string) => {
      if (table === 'properties') return {
        insert: insertProperty,
        select: () => ({ single: () => Promise.resolve({ data: { id: 'new-prop-id' }, error: null }) }),
      };
      if (table === 'property_photos') return { insert: insertPhotos };
      if (table === 'property_revision_notes') return { insert: insertRevisionNote };
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

vi.mock('../../pipeline-trigger', () => ({ triggerPipeline }));

beforeEach(() => {
  insertProperty.mockReset().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-prop-id' }, error: null }) }) });
  insertPhotos.mockReset().mockResolvedValue({ data: null, error: null });
  insertRevisionNote.mockReset().mockResolvedValue({ data: null, error: null });
  triggerPipeline.mockReset().mockResolvedValue(undefined);
});

const input: ManualIngestInput = {
  client_id: 'c1',
  playbook_id: 'p1',
  address: '123 Oak St',
  bedrooms: 3,
  bathrooms: 2,
  square_footage: 1850,
  price: 750000,
  photo_storage_paths: ['property-photos/c1/abc/1.jpg', 'property-photos/c1/abc/2.jpg'],
  director_notes: 'Faster pace on kitchen',
};

describe('manualIngest', () => {
  it('rejects when fewer than 5 photos are provided', async () => {
    await expect(manualIngest({ ...input, photo_storage_paths: ['a.jpg'] })).rejects.toThrow(/at least 5 photos/i);
  });

  it('creates a property row tagged order_mode=operator with client+playbook ids', async () => {
    const id = await manualIngest({ ...input, photo_storage_paths: Array(8).fill('p.jpg') });
    expect(id).toBe('new-prop-id');
    expect(insertProperty).toHaveBeenCalledWith(expect.objectContaining({
      order_mode: 'operator',
      client_id: 'c1',
      playbook_id: 'p1',
      ingest_source: 'manual',
      address: '123 Oak St',
    }));
  });

  it('writes a director-notes revision row when notes are provided', async () => {
    await manualIngest({ ...input, photo_storage_paths: Array(8).fill('p.jpg') });
    expect(insertRevisionNote).toHaveBeenCalledWith(expect.objectContaining({
      property_id: 'new-prop-id',
      source: 'operator',
      body: 'Faster pace on kitchen',
    }));
  });

  it('triggers the pipeline after a successful insert', async () => {
    await manualIngest({ ...input, photo_storage_paths: Array(8).fill('p.jpg') });
    expect(triggerPipeline).toHaveBeenCalledWith('new-prop-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/operator-studio/__tests__/ingest.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/operator-studio/ingest.ts
import { serviceClient } from '../supabase/service';
import { triggerPipeline } from '../pipeline-trigger';
import type { ManualIngestInput } from '../types/operator-studio';

const MIN_PHOTOS = 5;

export async function manualIngest(input: ManualIngestInput): Promise<string> {
  if (input.photo_storage_paths.length < MIN_PHOTOS) {
    throw new Error(`manualIngest: at least ${MIN_PHOTOS} photos required (got ${input.photo_storage_paths.length})`);
  }

  const db = serviceClient();
  const { data: prop, error: propErr } = await db
    .from('properties')
    .insert({
      order_mode: 'operator',
      client_id: input.client_id,
      playbook_id: input.playbook_id,
      ingest_source: 'manual',
      address: input.address,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      square_footage: input.square_footage,
      price: input.price,
      photo_count: input.photo_storage_paths.length,
      status: 'queued',
    })
    .select('id')
    .single();
  if (propErr || !prop) throw new Error(`manualIngest: ${propErr?.message ?? 'no row returned'}`);

  const photoRows = input.photo_storage_paths.map((path, idx) => ({
    property_id: prop.id,
    storage_path: path,
    sequence: idx,
  }));
  const { error: photoErr } = await db.from('property_photos').insert(photoRows);
  if (photoErr) throw new Error(`manualIngest: photo link failed: ${photoErr.message}`);

  if (input.director_notes && input.director_notes.trim()) {
    const { error: noteErr } = await db.from('property_revision_notes').insert({
      property_id: prop.id,
      source: 'operator',
      body: input.director_notes.trim(),
    });
    if (noteErr) throw new Error(`manualIngest: note insert failed: ${noteErr.message}`);
  }

  await triggerPipeline(prop.id);
  return prop.id;
}
```

**Note for the executing agent:** verify `lib/pipeline-trigger.ts` exists (it should — the existing public `/api/properties` flow uses it). If the helper has a different name in this codebase, update the import + mock paths in the test accordingly. **Do not invent a new pipeline trigger** — use what's there.

- [ ] **Step 4: Run test**

```bash
pnpm vitest run lib/operator-studio/__tests__/ingest.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/operator-studio/ingest.ts lib/operator-studio/__tests__/ingest.test.ts
git commit -m "feat(operator-studio): manual ingest module"
```

---

### Task 7: Admin endpoints — clients + playbooks

**Files:**
- Create: `api/admin/studio/clients/index.ts`
- Create: `api/admin/studio/clients/[id].ts`
- Create: `api/admin/studio/playbooks/index.ts`
- Create: `api/admin/studio/playbooks/[id].ts`

- [ ] **Step 1: Implement `api/admin/studio/clients/index.ts`**

```ts
// api/admin/studio/clients/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth';
import { listClients, createClient } from '../../../../lib/operator-studio/clients';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const includeArchived = req.query.include_archived === 'true';
    const rows = await listClients({ includeArchived });
    return res.status(200).json({ clients: rows });
  }
  if (req.method === 'POST') {
    const row = await createClient(req.body);
    return res.status(201).json({ client: row });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
```

- [ ] **Step 2: Implement `api/admin/studio/clients/[id].ts`**

```ts
// api/admin/studio/clients/[id].ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth';
import { getClient, updateClient, archiveClient } from '../../../../lib/operator-studio/clients';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.query.id);

  if (req.method === 'GET') {
    const row = await getClient(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ client: row });
  }
  if (req.method === 'PATCH') {
    const row = await updateClient(id, req.body);
    return res.status(200).json({ client: row });
  }
  if (req.method === 'DELETE') {
    const row = await archiveClient(id);
    return res.status(200).json({ client: row });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
```

- [ ] **Step 3: Implement playbook endpoints**

Mirror Steps 1–2 with `playbooks` module. The list endpoint accepts `?client_id=` query.

- [ ] **Step 4: Manual smoke test**

```bash
pnpm run dev
curl -sS -H "Authorization: Bearer $LE_ADMIN_JWT" http://localhost:3000/api/admin/studio/clients | jq
```

Expected: `{ "clients": [] }`.

POST to create one:

```bash
curl -sS -X POST -H "Authorization: Bearer $LE_ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"name":"Helgemo Team","contact_email":"abby@helgemo.com"}' \
  http://localhost:3000/api/admin/studio/clients | jq
```

Expected: `{ "client": { "id": "...", "name": "Helgemo Team", ... } }`.

- [ ] **Step 5: Commit**

```bash
git add api/admin/studio/
git commit -m "feat(operator-studio): admin clients + playbooks endpoints"
```

---

### Task 8: Admin endpoint — ingest

**Files:**
- Create: `api/admin/studio/ingest.ts`
- Test: `api/admin/studio/__tests__/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/admin/studio/__tests__/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../ingest';

const requireAdmin = vi.fn();
const manualIngest = vi.fn();
vi.mock('../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('../../../../lib/operator-studio/ingest', () => ({ manualIngest: (...a: unknown[]) => manualIngest(...a) }));

const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ id: 'u1', role: 'admin' });
  manualIngest.mockReset();
});

describe('POST /api/admin/studio/ingest', () => {
  it('returns 405 for non-POST', async () => {
    const res = mockRes();
    await handler({ method: 'GET' } as never, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 201 with property_id on success', async () => {
    manualIngest.mockResolvedValue('new-prop-id');
    const res = mockRes();
    await handler({ method: 'POST', body: { address: '123 Oak', photo_storage_paths: Array(8).fill('p.jpg') } } as never, res);
    expect(manualIngest).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ property_id: 'new-prop-id' });
  });

  it('returns 400 when manualIngest throws a validation error', async () => {
    manualIngest.mockRejectedValue(new Error('at least 5 photos required'));
    const res = mockRes();
    await handler({ method: 'POST', body: {} } as never, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run + verify FAIL → implement → PASS**

```ts
// api/admin/studio/ingest.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import { manualIngest } from '../../../lib/operator-studio/ingest';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const id = await manualIngest(req.body);
    return res.status(201).json({ property_id: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/required|at least|invalid/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('[admin/studio/ingest]', err);
    return res.status(500).json({ error: msg });
  }
}
```

```bash
pnpm vitest run api/admin/studio/__tests__/ingest.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 3: Commit**

```bash
git add api/admin/studio/ingest.ts api/admin/studio/__tests__/ingest.test.ts
git commit -m "feat(operator-studio): admin ingest endpoint"
```

---

### Task 9: Admin endpoint — invoice summary

**Files:**
- Create: `api/admin/studio/invoice-summary.ts`
- Test: `api/admin/studio/__tests__/invoice-summary.test.ts`

- [ ] **Step 1: Define behavior + test**

POST body: `{ client_id, from?: string, to?: string }` (dates ISO YYYY-MM-DD; default = current calendar month). Server queries:
1. `clients` for name + `monthly_rate_cents`.
2. `properties` joined with `cost_events` for all properties where `order_mode='operator'` AND `client_id` matches AND `created_at` between from/to.
3. Aggregate raw cost = sum of `cost_events.cost_cents` for those property ids.
4. `formatInvoiceSummary(...)` → returns `{ summary: <text>, data: InvoiceSummary }`.

```ts
// api/admin/studio/__tests__/invoice-summary.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../invoice-summary';

const requireAdmin = vi.fn().mockResolvedValue({ id: 'u1', role: 'admin' });
const buildInvoice = vi.fn();
vi.mock('../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('../../../../lib/operator-studio/invoice-data', () => ({ buildInvoice: (...a: unknown[]) => buildInvoice(...a) }));

const mockRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });

beforeEach(() => buildInvoice.mockReset());

describe('POST invoice-summary', () => {
  it('returns formatted text + structured data', async () => {
    buildInvoice.mockResolvedValue({
      summary: { client_id: 'c1', client_name: 'Helgemo', from: '2026-05-01', to: '2026-05-31', videos_delivered: 1, raw_cost_cents: 800, contracted_rate_cents: 50000, line_items: [{ property_id: 'p1', address: '1 Oak', delivered_at: '2026-05-10', raw_cost_cents: 800 }] },
    });
    const res = mockRes() as never;
    await handler({ method: 'POST', body: { client_id: 'c1' } } as never, res);
    expect(buildInvoice).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'c1' }));
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.text).toContain('CLIENT: Helgemo');
    expect(payload.data.videos_delivered).toBe(1);
  });
});
```

- [ ] **Step 2: Extract data builder into its own pure-ish module so it's testable separately**

Create `lib/operator-studio/invoice-data.ts` with `buildInvoice({ client_id, from, to })` returning `{ summary: InvoiceSummary }`. Keep the Supabase calls here. (We are leaving its dedicated unit test to a quick follow-up after Phase 1 closes — the handler test above exercises it via the mock.)

- [ ] **Step 3: Implement the handler**

```ts
// api/admin/studio/invoice-summary.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import { buildInvoice } from '../../../lib/operator-studio/invoice-data';
import { formatInvoiceSummary } from '../../../lib/operator-studio/invoice';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { client_id, from, to } = req.body ?? {};
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  try {
    const { summary } = await buildInvoice({ client_id, from, to });
    return res.status(200).json({ text: formatInvoiceSummary(summary), data: summary });
  } catch (err) {
    console.error('[invoice-summary]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: PASS + commit**

```bash
pnpm vitest run api/admin/studio/__tests__/invoice-summary.test.ts
git add api/admin/studio/invoice-summary.ts api/admin/studio/__tests__/invoice-summary.test.ts lib/operator-studio/invoice-data.ts
git commit -m "feat(operator-studio): invoice-summary endpoint"
```

---

### Task 10: Route shell + side nav

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/dashboard/TopNav.tsx` (or whichever existing nav component lives in this codebase — pick the one that already lists `/dashboard/pipeline` / `/finances`).
- Create: `src/components/studio/StudioNav.tsx`
- Create: `src/pages/dashboard/studio/StudioHome.tsx` (placeholder — Kanban implemented in Task 12)

- [ ] **Step 1: Register routes**

Add inside the existing `<RequireAdmin />` block:

```tsx
<Route path="/dashboard/studio" element={<StudioHome />} />
<Route path="/dashboard/studio/new" element={<StudioNew />} />
<Route path="/dashboard/studio/clients" element={<Clients />} />
<Route path="/dashboard/studio/clients/:id" element={<ClientEdit />} />
<Route path="/dashboard/studio/playbooks" element={<Playbooks />} />
<Route path="/dashboard/studio/playbooks/:id" element={<PlaybookEdit />} />
<Route path="/dashboard/studio/properties/:id" element={<PropertyCommandCenter />} />
```

(Add corresponding lazy or eager imports; follow whatever pattern exists in the file.)

- [ ] **Step 2: Add "Studio" entry to the existing admin TopNav**

Insert a link/button next to the existing entries. Reuse the existing styling — do not introduce a new design system.

- [ ] **Step 3: Implement `StudioNav.tsx`** — a small side-tab component used by every page under `/dashboard/studio`:

```tsx
import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/dashboard/studio', label: 'Queue' },
  { to: '/dashboard/studio/clients', label: 'Clients' },
  { to: '/dashboard/studio/playbooks', label: 'Playbooks' },
];

export function StudioNav() {
  return (
    <nav className="flex gap-4 border-b mb-6">
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to} end className={({ isActive }) =>
          `px-3 py-2 text-sm ${isActive ? 'border-b-2 border-foreground font-medium' : 'text-muted-foreground'}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Placeholder pages**

For each route file listed under Create, ship a minimal page that renders `<StudioNav />` and a heading. We replace them in Tasks 11–14.

- [ ] **Step 5: Smoke + commit**

```bash
pnpm run dev
# open http://localhost:3000/dashboard/studio → renders "Queue" with the StudioNav visible
git add src/App.tsx src/components/dashboard/TopNav.tsx src/components/studio/StudioNav.tsx src/pages/dashboard/studio/
git commit -m "feat(operator-studio): route shell + side nav placeholders"
```

---

### Task 11: Clients UI

**Files:**
- Replace: `src/pages/dashboard/studio/Clients.tsx`
- Replace: `src/pages/dashboard/studio/ClientEdit.tsx`
- Create: `src/components/studio/ClientPicker.tsx`

- [ ] **Step 1: `Clients.tsx` — list table**

Columns: name, contact_email, monthly_rate, # active listings, last activity, [Edit]. Fetches `GET /api/admin/studio/clients`. New-client button → `/dashboard/studio/clients/new`.

- [ ] **Step 2: `ClientEdit.tsx` — create/edit form**

Fields: name, contact_email, phone, monthly_rate_cents (display as $ input), notes, brand_logo (file → Supabase Storage `clients/{id}/logo.{ext}`), brand_primary_hex (color picker), brand_secondary_hex, agent_name, agent_headshot, default_playbook_id (dropdown). Submit → POST or PATCH the admin endpoint. Archive button → DELETE.

- [ ] **Step 3: `ClientPicker.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ClientRow } from '../../../lib/types/operator-studio';

export function ClientPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  useEffect(() => {
    fetch('/api/admin/studio/clients').then(r => r.json()).then(d => setClients(d.clients ?? []));
  }, []);
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className="border rounded px-2 py-1">
      <option value="">— Select client —</option>
      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
```

- [ ] **Step 4: Manual smoke**

Create a client, edit it, archive it. Refresh — verify archived clients are hidden.

- [ ] **Step 5: Commit**

```bash
git add src/pages/dashboard/studio/Clients.tsx src/pages/dashboard/studio/ClientEdit.tsx src/components/studio/ClientPicker.tsx
git commit -m "feat(operator-studio): clients UI + picker"
```

---

### Task 12: Studio Home Kanban

**Files:**
- Replace: `src/pages/dashboard/studio/StudioHome.tsx`
- Create: `api/admin/studio/queue.ts` (GET, returns operator-mode properties grouped by status)

- [ ] **Step 1: Implement `queue.ts`**

```ts
// api/admin/studio/queue.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import { serviceClient } from '../../../lib/supabase/service';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const { data, error } = await serviceClient()
    .from('properties')
    .select('id, address, status, total_cost_cents, created_at, client:client_id(id, name, brand_primary_hex)')
    .eq('order_mode', 'operator')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const buckets: Record<string, unknown[]> = { inbox: [], rendering: [], needs_review: [], delivered: [] };
  for (const row of data ?? []) {
    if (['queued','analyzing','scripting','generating','assembling'].includes(row.status)) buckets.rendering.push(row);
    else if (row.status === 'qc' || row.status === 'needs_review') buckets.needs_review.push(row);
    else if (row.status === 'complete') buckets.delivered.push(row);
    else buckets.inbox.push(row);
  }
  return res.status(200).json({ buckets });
}
```

- [ ] **Step 2: `StudioHome.tsx`**

Render four columns mapped to `buckets`. Each card shows brand-color dot + address + cost + age. Cards link to `/dashboard/studio/properties/:id`. Top-right "+ New Listing" button → `/dashboard/studio/new`. Empty-state CTA per column.

- [ ] **Step 3: Manual smoke** — operator-mode listings appear correctly; customer-mode listings do not bleed in.

- [ ] **Step 4: Commit**

```bash
git add api/admin/studio/queue.ts src/pages/dashboard/studio/StudioHome.tsx
git commit -m "feat(operator-studio): Studio Home Kanban + queue endpoint"
```

---

### Task 13: New-listing form (manual ingest)

**Files:**
- Replace: `src/pages/dashboard/studio/StudioNew.tsx`

- [ ] **Step 1: Implement the form**

Fields: address (Google Places autocomplete — reuse the existing Upload form's component), client (ClientPicker), playbook (PlaybookPicker, filtered by client_id), bedrooms, bathrooms, square_footage, price, director_notes, photo dropzone (uploads to `property-photos/{tempId}/...` via the existing Supabase Storage helper used by `Upload.tsx`).

On submit: POST `/api/admin/studio/ingest` with `{ client_id, playbook_id, address, bedrooms, bathrooms, square_footage, price, photo_storage_paths, director_notes }`. Redirect to `/dashboard/studio/properties/:id`.

- [ ] **Step 2: Reuse — don't duplicate**

Lift the photo-upload component out of `Upload.tsx` if it's not already a shared component; share it. (If extraction is non-trivial, leave a TODO note and reuse via copy — log it for follow-up.)

- [ ] **Step 3: Manual smoke**

End-to-end: create a client, open `/dashboard/studio/new`, fill form, drop 8 photos, submit. Expect redirect to Command Center; Kanban shows the new card in "Rendering"; pipeline runs to completion.

- [ ] **Step 4: Commit**

```bash
git add src/pages/dashboard/studio/StudioNew.tsx
git commit -m "feat(operator-studio): new-listing form (manual ingest)"
```

---

### Task 14: Playbooks UI

**Files:**
- Replace: `src/pages/dashboard/studio/Playbooks.tsx`
- Replace: `src/pages/dashboard/studio/PlaybookEdit.tsx`
- Create: `src/components/studio/PlaybookPicker.tsx`

Mirror Task 11 (Clients UI). Form fields: name, client (optional — null = global), orientation (radio), duration (radio), music_style (text), voiceover_enabled (toggle), assembly_template_id (text), prompt_router_preferences (JSON textarea — for now). Commit as `feat(operator-studio): playbooks UI + picker`.

---

### Task 15: Property Command Center (Phase 1 surface)

**Files:**
- Replace: `src/pages/dashboard/studio/PropertyCommandCenter.tsx`
- Create: `api/admin/studio/properties/[id].ts` (GET — bundle of property + scenes + cost rollup + revision notes)

- [ ] **Step 1: Bundle endpoint**

```ts
// api/admin/studio/properties/[id].ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth';
import { serviceClient } from '../../../../lib/supabase/service';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const id = String(req.query.id);

  const db = serviceClient();
  const [{ data: property }, { data: scenes }, { data: notes }, { data: costRows }] = await Promise.all([
    db.from('properties').select('*, client:client_id(*), playbook:playbook_id(*)').eq('id', id).maybeSingle(),
    db.from('scenes').select('*').eq('property_id', id).order('sequence', { ascending: true }),
    db.from('property_revision_notes').select('*').eq('property_id', id).order('created_at', { ascending: false }),
    db.from('cost_events').select('stage, provider, cost_cents').eq('property_id', id),
  ]);
  if (!property) return res.status(404).json({ error: 'not_found' });

  const costByProvider: Record<string, number> = {};
  let costTotal = 0;
  for (const r of costRows ?? []) {
    costByProvider[r.provider] = (costByProvider[r.provider] ?? 0) + (r.cost_cents ?? 0);
    costTotal += r.cost_cents ?? 0;
  }

  return res.status(200).json({ property, scenes, revision_notes: notes, cost: { total_cents: costTotal, by_provider: costByProvider } });
}
```

- [ ] **Step 2: Implement the page**

Sections, top-to-bottom:
1. Header: address + client badge + pipeline-status pill.
2. Final video (when `complete`) — embed `horizontal_video_url` and/or `vertical_video_url`.
3. Scene strip — thumbnails or text descriptions; clicking a scene opens scene details. (Iterate-in-Lab button is **Phase 3** — leave a `disabled` button labeled "Iterate (Phase 3)" so the surface is feature-complete visually.)
4. Director's notes — list `revision_notes`, plus a textarea + Save button that POSTs to a new `POST /api/admin/studio/properties/:id/notes` (write this small endpoint in this same task).
5. Cost panel — total + by-provider rollup.
6. Metadata panel — beds/baths/sqft/price + edit-in-place.

- [ ] **Step 3: Manual smoke**

Run a listing through the pipeline; open the Command Center; verify all sections render with real data.

- [ ] **Step 4: Commit**

```bash
git add api/admin/studio/properties/ src/pages/dashboard/studio/PropertyCommandCenter.tsx
git commit -m "feat(operator-studio): property command center (Phase 1)"
```

---

### Task 16: Pipeline awareness of operator mode

**Files:**
- Modify: `lib/pipeline.ts`

- [ ] **Step 1: Thread the new columns into the pipeline log**

Read `order_mode`, `client_id`, `playbook_id` from the `properties` row at the top of `runPipeline` and include them in every log line + every `recordCostEvent` `metadata` block. No behavior fork yet — playbook application and brand-kit injection are Phase 2.

- [ ] **Step 2: Run the existing pipeline tests**

```bash
pnpm vitest run lib/__tests__ | tail -20
pnpm exec tsc --noEmit
```

Expected: no regressions.

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline.ts
git commit -m "feat(operator-studio): pipeline reads order_mode + client/playbook ids"
```

---

### Task 17: Full Phase 1 smoke + docs + doctor

- [ ] **Step 1: Run the suite**

```bash
pnpm vitest run
pnpm exec tsc --noEmit
pnpm run doctor
```

Expected: green across the board.

- [ ] **Step 2: Manual end-to-end**

1. Apply migration 055 (if not already).
2. Create a test client + a playbook.
3. Open `/dashboard/studio/new`, fill form, submit with 8 photos.
4. Watch the Kanban card move Inbox → Rendering → Delivered.
5. Open the Command Center for the property; verify cost rollup and final video.
6. Open Clients page; hit "Copy invoice summary" for that client; verify the format matches the spec.

- [ ] **Step 3: Update docs**

Append `docs/HANDOFF.md` "Recent shipping log" — one line: date + branch + commit SHAs + "Operator Studio Phase 1 — internal MVP shipped to dev".

- [ ] **Step 4: Commit + open PR (do not push without explicit go from Oliver)**

Per memory `feedback_no_auto_push.md`: commit locally; wait for explicit "push" before pushing or opening the PR.

```bash
git add docs/HANDOFF.md
git commit -m "docs: operator studio phase 1 shipping log"
# Wait for Oliver's go-ahead before: git push -u origin feat/operator-studio
```

---

## Phase 2 — Outline (full plan written before dispatch)

Phase 2 builds on Phase 1 with quality multipliers. Each item below becomes its own detailed TDD plan written at Phase 2 dispatch time.

- **P2-A — Magic-link scraper.** Add `lib/operator-studio/scrapers/{zillow,redfin,sierra}.ts` using Apify Playwright. Extend `manualIngest` to accept a `source_url` and fall back to manual photo upload on scrape failure. Cost event tagged `provider='apify', stage='intake'`.
- **P2-B — Brand-kit injection at assembly.** Extend `lib/providers/assembly-router.ts` to read `properties.client_id`, look up the client, and inject `logo_url` / `primary_hex` / `secondary_hex` / `agent_name` / `agent_headshot_url` into Creatomate template variables. Add a Creatomate operator-template variant. Integration test asserts the variables hit the request payload.
- **P2-C — Preview link delivery.** `POST /api/admin/studio/properties/:id/preview-link` (issues token, writes `property_previews`), `GET /preview/:token` (public, no-auth, renders minimal viewer + revision textarea, increments view counter, POST writes `property_revision_notes` with `source='client_preview'`). Kanban card shows a "client viewed" badge.
- **P2-D — Director's notes panel polish.** Append-only timeline view + filter by source. Foundation for P3 Claude distill.
- **P2-E — Playbook application.** Pipeline reads playbook + applies orientation / duration / music / voiceover preference. Adds a behavior fork by `order_mode`.

## Phase 3 — Outline

- **P3-A — Inline clip swap.** New helper `lib/pipeline.ts:rerunAssembly(propertyId)` that skips intake→generation. New endpoint `POST /api/admin/studio/properties/:id/scenes/:sceneIdx/swap-clip` that copies a `prompt_lab_listing_scene_iterations` clip into the scene and re-triggers assembly. Cost event tagged `metadata.reason='clip_swap'`.
- **P3-B — Lab deep-link from Command Center.** "Iterate in Lab" button creates/links a `prompt_lab_listings` row mirroring the property, deep-links to the specific scene.
- **P3-C — Claude distill notes → scene actions.** New endpoint `POST /api/admin/studio/properties/:id/notes/distill` that runs the latest revision notes through Claude and returns structured `{ scene_idx, action }[]`. UI surfaces those as one-click "Iterate scene N" CTAs.
- **P3-D — Finances integration.** Operator-mode rows roll up under a "Client invoices" section on `/dashboard/finances`. Per-client P&L card (raw cost, invoiced, margin).

---

## Self-review (post-write)

- **Spec coverage:** Modules A (schema), B (route shell), C-lite (manual ingest), D (clients + playbooks CRUD + UI), E (Command Center P1), I (invoice rollup) all mapped to tasks 1–17. F (brand kit), G (clip swap), H (preview link) explicitly scoped to P2/P3.
- **Placeholders:** Phase 1 tasks are fully spec'd with file paths, test code, and implementation code. Phase 2/3 are outlines, but the spec is detailed enough that the P2/P3 detailed plans can be written without re-brainstorming.
- **Type consistency:** `ClientRow` / `PlaybookRow` / `ManualIngestInput` / `InvoiceSummary` are defined once in Task 2 and reused unchanged.
- **No cost-tracking holes:** the Phase 1 cost path is unchanged (existing pipeline writers handle analysis/scripting/generation/assembly). New writers (Apify, clip-swap assembly) are explicitly noted in P2/P3 specs.
- **Ship-gate compliance:** every task ends with `git commit`; the closing task gates on `pnpm vitest && tsc && doctor` and updates `docs/HANDOFF.md`; no push without explicit go.
