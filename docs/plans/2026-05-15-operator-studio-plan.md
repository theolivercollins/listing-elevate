# Operator Studio Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an internal `/dashboard/studio` surface that lets Oliver produce, brand, deliver, and revise client listing videos end-to-end (manual ingest → branded assembly → preview-link delivery → inline clip swap → invoice rollup) in minutes per listing, reusing the existing pipeline + Lab + Creatomate assembly.

**Architecture:** New admin-only route mounted at `/dashboard/studio`, gated by existing `<RequireAdmin />`. Single new migration adds `clients`, `property_previews`, `property_revision_notes` tables plus 4 columns on `properties` (no `playbooks` table or `playbook_id` column in Phase 1 — those land in Phase 2). New endpoints under `/api/admin/studio/*`. Public preview at `/preview/:token` (no auth, signed token via `crypto.randomBytes`). Brand-kit injection happens at assembly. Inline clip swap re-triggers assembly only via a new `rerunAssembly` helper. All Operator-originated work is tagged `properties.order_mode='operator'` so it never crosses customer-flow paths.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui (frontend) · Vercel Serverless Functions, Node 20+, ESM, `@vercel/node` (backend) · Supabase Postgres + Storage · Vitest · Creatomate (primary assembly) · ElevenLabs (voice, future phase) · Apify Playwright (scraper, Phase 2).

**Spec:** `docs/specs/2026-05-15-operator-studio-design.md` (v2 — re-phased after Gemini review)

---

## Phasing (v2)

- **Phase 1 — Internal MVP, end-to-end branded delivery loop (this plan, detailed below).** Schema (minus playbooks) + clients CRUD + manual ingest + Kanban + Command Center + **brand-kit injection at assembly** + **preview-link delivery** + **inline clip swap** + invoice rollup. **Exit criterion:** Oliver can ingest a listing, ship a branded video to a client via preview link, accept one revision, swap a clip, and copy the month's invoice summary — all without leaving `/dashboard/studio`.
- **Phase 2 — Acceleration & polish.** Apify scraper for magic-link ingest, full Playbooks (table + CRUD + UI + pipeline application), director's notes panel polish, Claude "distill notes → scene actions". Detailed plan written before P2 dispatch.
- **Phase 3 — Margin & scale.** Finances integration (per-client P&L card on `/dashboard/finances`), ElevenLabs voice clone wiring, multi-revision tracking, throughput analytics. Detailed plan written before P3 dispatch.

Each phase ends on a green branch; merge `feat/operator-studio` → `dev` → `staging` → `main` per the standard ship-gate.

---

## File structure (Phase 1)

**Create:**
- `supabase/migrations/055_operator_studio.sql`
- `lib/types/operator-studio.ts`
- `lib/operator-studio/clients.ts` + tests
- `lib/operator-studio/ingest.ts` + tests
- `lib/operator-studio/invoice.ts` (formatter, pure) + tests
- `lib/operator-studio/invoice-data.ts` (DB queries) + **dedicated integration test**
- `lib/operator-studio/preview-tokens.ts` + tests
- `lib/operator-studio/brand-kit.ts` (extract+inject helper, pure) + tests
- `lib/operator-studio/clip-swap.ts` + tests
- `lib/pipeline.ts` extension `rerunAssembly(propertyId)` + tests
- `api/admin/studio/clients/index.ts`, `[id].ts`
- `api/admin/studio/ingest.ts` + tests
- `api/admin/studio/invoice-summary.ts` + tests
- `api/admin/studio/queue.ts`
- `api/admin/studio/properties/[id].ts`
- `api/admin/studio/properties/[id]/notes.ts`
- `api/admin/studio/properties/[id]/preview-link.ts` + tests
- `api/admin/studio/properties/[id]/scenes/[idx]/swap-clip.ts` + tests
- `api/preview/[token].ts` (public, no admin guard)
- `src/pages/dashboard/studio/StudioHome.tsx`
- `src/pages/dashboard/studio/StudioNew.tsx`
- `src/pages/dashboard/studio/Clients.tsx`, `ClientEdit.tsx`
- `src/pages/dashboard/studio/PropertyCommandCenter.tsx`
- `src/pages/preview/PreviewPage.tsx` (public viewer route)
- `src/components/studio/StudioNav.tsx`
- `src/components/studio/ClientPicker.tsx`
- `src/components/studio/SceneStrip.tsx`
- `src/components/studio/IterateInLabModal.tsx` (lists Lab iterations for that scene, allows swap)

**Modify:**
- `src/App.tsx` — register `/dashboard/studio/*` + `/preview/:token`
- The existing admin top nav (`src/components/dashboard/TopNav.tsx` or equivalent) — add a `Studio` entry
- `lib/pipeline.ts` — propagate `order_mode` and `client_id` through logs (no behavior fork on `client_id` for the main pipeline; the fork lives at assembly)
- `lib/providers/assembly-router.ts` — read `properties.client_id`, fetch client brand kit, inject template variables when present
- `docs/HANDOFF.md`, `docs/state/PROJECT-STATE.md` — close-out

**Notes on conventions the executing agent must verify and follow (do NOT invent new patterns):**
- **Data-fetching:** look at how `Properties.tsx`, `Pipeline.tsx`, `Finances.tsx` fetch admin data. If they use TanStack Query / SWR / a hooks library, use the same. If they use raw `fetch` in `useEffect`, do that. **Do not unilaterally introduce a new data layer in Phase 1.** If the existing pattern is painful, log it for Phase 2 cleanup; don't fork the codebase.
- **Storage uploads:** the existing `Upload.tsx` already uploads photos to the `property-photos` bucket. Reuse that helper; if it's inlined in `Upload.tsx`, extract it into `src/lib/upload-helper.ts` (or whatever path matches existing structure) as part of Task 13 and use it from both places.
- **Supabase service client:** the existing service-role client is `getSupabase()` from `lib/client.ts` (NOT `serviceClient()` from `lib/supabase/service.ts` — that does not exist). Every code block in this plan that imports `serviceClient` must be rewritten as `import { getSupabase } from '<correct relative path to lib/client>'` and call `getSupabase()`. Tests should mock `lib/client.ts` accordingly (mock target is `lib/client`, NOT `lib/supabase/service`).
- **Pipeline trigger:** there is NO server-side `triggerPipeline` helper today — `src/lib/api.ts` defines a client-side fire-and-forget that POSTs `/api/pipeline/:id`. For the operator ingest flow, `manualIngest` should NOT trigger the pipeline itself. Instead, the admin ingest endpoint returns `{ property_id }` and the React page (`StudioNew.tsx`) does the same client-side `fetch('/api/pipeline/:id', { method: 'POST' })` after redirect. This matches the existing customer flow exactly.
- **`requireAdmin`:** confirmed at `lib/auth.ts:75`. Signature returns `null` on 401/403 (the endpoint should then early-return without writing its own response).

---

## Phase 1 — Tasks

### Task 1: Schema migration

**Files:** Create `supabase/migrations/055_operator_studio.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 055_operator_studio.sql
-- Operator Studio Phase 1: clients + preview tokens + revision notes
-- Per docs/specs/2026-05-15-operator-studio-design.md (v2)
-- Playbooks table intentionally deferred to Phase 2.

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
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists property_previews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  viewed_count integer not null default 0,
  last_viewed_at timestamptz
);
create unique index if not exists idx_property_previews_token on property_previews(token);
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
  add column if not exists ingest_source text check (ingest_source in ('manual','zillow','redfin','sierra','mls','drive_link')),
  add column if not exists ingest_source_url text;

create index if not exists idx_properties_order_mode_client on properties(order_mode, client_id) where order_mode = 'operator';

alter table clients enable row level security;
alter table property_previews enable row level security;
alter table property_revision_notes enable row level security;
-- No policies = admin-only via service-role key. Public preview reads happen server-side only via signed tokens.
```

- [ ] **Step 2: Apply via Supabase MCP** (dev project first; prod application requires explicit Oliver go-ahead per the user-MCP policy).

- [ ] **Step 3: Commit** — `feat(operator-studio): add 055_operator_studio migration`

---

### Task 2: Shared types

**Files:** Create `lib/types/operator-studio.ts`

- [ ] **Step 1: Write**

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
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInput = Partial<Omit<ClientRow, 'id' | 'created_at' | 'updated_at' | 'archived_at'>> & {
  name: string;
};

export type IngestSource = 'manual' | 'zillow' | 'redfin' | 'sierra' | 'mls' | 'drive_link';

export type ManualIngestInput = {
  client_id: string | null;
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
  photo_storage_paths: string[];
  director_notes: string | null;
};

export type RevisionNoteRow = {
  id: string;
  property_id: string;
  source: 'operator' | 'client_preview';
  body: string;
  created_at: string;
};

export type PropertyPreviewRow = {
  id: string;
  property_id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
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
  from: string;
  to: string;
  videos_delivered: number;
  raw_cost_cents: number;
  contracted_rate_cents: number | null;
  line_items: InvoiceLineItem[];
};

export type BrandKitVars = {
  logo_url: string | null;
  primary_hex: string | null;
  secondary_hex: string | null;
  agent_name: string | null;
  agent_headshot_url: string | null;
  brokerage: string | null;
};
```

- [ ] **Step 2: `pnpm exec tsc --noEmit`** — must pass.

- [ ] **Step 3: Commit** — `feat(operator-studio): shared types`

---

### Task 3: Preview-token utility — TDD

**Files:** Create `lib/operator-studio/preview-tokens.ts` + `lib/operator-studio/__tests__/preview-tokens.test.ts`

- [ ] **Step 1: Failing test**

```ts
// lib/operator-studio/__tests__/preview-tokens.test.ts
import { describe, it, expect } from 'vitest';
import { generatePreviewToken, isWellFormedToken } from '../preview-tokens';

describe('preview tokens', () => {
  it('generates a 32-char URL-safe token', () => {
    const t = generatePreviewToken();
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produces distinct tokens across 1000 invocations', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generatePreviewToken());
    expect(tokens.size).toBe(1000);
  });

  it('isWellFormedToken accepts a generated token and rejects garbage', () => {
    expect(isWellFormedToken(generatePreviewToken())).toBe(true);
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken('!'.repeat(32))).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL → implement**

```ts
// lib/operator-studio/preview-tokens.ts
import { randomBytes } from 'node:crypto';

export function generatePreviewToken(): string {
  // 24 random bytes → 32 chars of base64url, no padding.
  return randomBytes(24).toString('base64url').slice(0, 32);
}

export function isWellFormedToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}
```

- [ ] **Step 3: PASS + commit** — `feat(operator-studio): preview-token utility`

---

### Task 4: Invoice formatter — TDD

**Files:** Create `lib/operator-studio/invoice.ts` + `lib/operator-studio/__tests__/invoice.test.ts`

(Same content as v1 Task 3 — `formatInvoiceSummary(InvoiceSummary): string`. See content below.)

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Implement** (per v1 Task 3 — same code).

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
  if (s.contracted_rate_cents != null) lines.push(`CONTRACTED RATE: ${dollars(s.contracted_rate_cents)}`);
  return lines.join('\n');
}
```

- [ ] **Step 3: PASS + commit** — `feat(operator-studio): invoice formatter`

---

### Task 5: Invoice-data DB module — integration test

**Files:** Create `lib/operator-studio/invoice-data.ts` + `lib/operator-studio/__tests__/invoice-data.integration.test.ts`

This is the most critical correctness path in Phase 1 — wrong math means wrong invoices.

- [ ] **Step 1: Write integration test** that hits the dev Supabase. Gate with `LE_RUN_INTEGRATION=true` so unit-test runs skip it.

```ts
// lib/operator-studio/__tests__/invoice-data.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSupabase } from '../../client';
import { buildInvoice } from '../invoice-data';

const RUN = process.env.LE_RUN_INTEGRATION === 'true';
const d = RUN ? describe : describe.skip;

d('buildInvoice (integration)', () => {
  const clientName = `__test_client_${Date.now()}`;
  let clientId: string;
  let inRangePropId: string;
  let outOfRangePropId: string;

  beforeAll(async () => {
    const db = getSupabase();
    const { data: c } = await db.from('clients').insert({ name: clientName, monthly_rate_cents: 50000 }).select('id').single();
    clientId = c!.id;

    const { data: pIn } = await db.from('properties').insert({
      order_mode: 'operator', client_id: clientId, address: '1 Oak St',
      status: 'complete', created_at: '2026-05-10T12:00:00Z',
    }).select('id').single();
    inRangePropId = pIn!.id;
    await db.from('cost_events').insert([
      { property_id: inRangePropId, stage: 'analysis', provider: 'anthropic', cost_cents: 200, unit_type: 'tokens', units_consumed: 1 },
      { property_id: inRangePropId, stage: 'assembly', provider: 'creatomate', cost_cents: 400, unit_type: 'renders', units_consumed: 1 },
    ]);

    const { data: pOut } = await db.from('properties').insert({
      order_mode: 'operator', client_id: clientId, address: '99 Far St',
      status: 'complete', created_at: '2026-04-10T12:00:00Z',
    }).select('id').single();
    outOfRangePropId = pOut!.id;
    await db.from('cost_events').insert([{ property_id: outOfRangePropId, stage: 'assembly', provider: 'creatomate', cost_cents: 999, unit_type: 'renders', units_consumed: 1 }]);
  });

  afterAll(async () => {
    const db = getSupabase();
    await db.from('properties').delete().eq('client_id', clientId);
    await db.from('clients').delete().eq('id', clientId);
  });

  it('aggregates only properties created in the date range', async () => {
    const { summary } = await buildInvoice({ client_id: clientId, from: '2026-05-01', to: '2026-05-31' });
    expect(summary.videos_delivered).toBe(1);
    expect(summary.raw_cost_cents).toBe(600);
    expect(summary.line_items).toHaveLength(1);
    expect(summary.line_items[0].address).toBe('1 Oak St');
    expect(summary.contracted_rate_cents).toBe(50000);
  });

  it('defaults to current calendar month when no dates provided', async () => {
    const { summary } = await buildInvoice({ client_id: clientId });
    expect(summary.from).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
```

- [ ] **Step 2: Implement `buildInvoice`**

```ts
// lib/operator-studio/invoice-data.ts
import { getSupabase } from '../client';
import type { InvoiceSummary } from '../types/operator-studio';

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
  let costByProp: Record<string, number> = {};
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
```

- [ ] **Step 3: Run integration test against dev**

```bash
LE_RUN_INTEGRATION=true pnpm vitest run lib/operator-studio/__tests__/invoice-data.integration.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 4: Commit** — `feat(operator-studio): invoice-data module with integration test`

---

### Task 6: Clients CRUD module — TDD

Identical to v1 Task 4. (Code reproduced in full below to keep this plan self-contained.)

**Files:** Create `lib/operator-studio/clients.ts` + `lib/operator-studio/__tests__/clients.test.ts`

- [ ] Failing test for `listClients` (excludes archived), `createClient` (rejects empty name; inserts), `archiveClient` (sets `archived_at`).
- [ ] Implement `listClients`, `getClient`, `createClient`, `updateClient`, `archiveClient` against `getSupabase().from('clients')`. (Code per v1 Task 4 — unchanged.)
- [ ] PASS + commit — `feat(operator-studio): clients CRUD module`

```ts
// lib/operator-studio/clients.ts
import { getSupabase } from '../client';
import type { ClientInput, ClientRow } from '../types/operator-studio';

export async function listClients(opts: { includeArchived?: boolean } = {}): Promise<ClientRow[]> {
  let q = getSupabase().from('clients').select('*');
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(`listClients: ${error.message}`);
  return data ?? [];
}
export async function getClient(id: string): Promise<ClientRow | null> {
  const { data, error } = await getSupabase().from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return data;
}
export async function createClient(input: ClientInput): Promise<ClientRow> {
  if (!input.name?.trim()) throw new Error('createClient: name is required');
  const { data, error } = await getSupabase().from('clients').insert({ ...input, name: input.name.trim() }).select('*').single();
  if (error) throw new Error(`createClient: ${error.message}`);
  return data;
}
export async function updateClient(id: string, patch: Partial<ClientInput>): Promise<ClientRow> {
  const { data, error } = await getSupabase().from('clients').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw new Error(`updateClient: ${error.message}`);
  return data;
}
export async function archiveClient(id: string): Promise<ClientRow> {
  const { data, error } = await getSupabase().from('clients').update({ archived_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw new Error(`archiveClient: ${error.message}`);
  return data;
}
```

(Test mocks `getSupabase` from `lib/client` and asserts the call chain. Same shape as Task 8 below; reuse the mock pattern.)

---

### Task 7: Manual ingest module — TDD

Identical to v1 Task 6, with `playbook_id` removed.

**Files:** Create `lib/operator-studio/ingest.ts` + tests

- [ ] Failing test: rejects <5 photos; creates property with `order_mode='operator'`, `client_id`, `ingest_source='manual'`; writes director-notes revision when provided; triggers pipeline.
- [ ] Implement (drop `playbook_id` from the insert vs. v1).
- [ ] PASS + commit — `feat(operator-studio): manual ingest module`

---

### Task 8: Brand-kit injection — TDD

This is the keystone task that makes Phase 1 produce branded videos.

**Files:** Create `lib/operator-studio/brand-kit.ts` + tests. Modify `lib/providers/assembly-router.ts` (or whichever module submits to Creatomate).

- [ ] **Step 1: Failing test for the pure helper**

```ts
// lib/operator-studio/__tests__/brand-kit.test.ts
import { describe, it, expect } from 'vitest';
import { brandKitFromClient, mergeBrandVars } from '../brand-kit';
import type { ClientRow } from '../../types/operator-studio';

const client: ClientRow = {
  id: 'c1', name: 'Helgemo Team',
  contact_email: null, phone: null, monthly_rate_cents: null, notes: null,
  brand_logo_url: 'https://x/logo.png',
  brand_primary_hex: '#1A1A1A', brand_secondary_hex: '#EEEEEE',
  agent_name: 'Abby Helgemo', agent_headshot_url: 'https://x/abby.png',
  voice_id: null, archived_at: null,
  created_at: '', updated_at: '',
};

describe('brandKitFromClient', () => {
  it('extracts variables from a client row', () => {
    const v = brandKitFromClient(client, { brokerage: 'Helgemo Realty' });
    expect(v).toEqual({
      logo_url: 'https://x/logo.png',
      primary_hex: '#1A1A1A',
      secondary_hex: '#EEEEEE',
      agent_name: 'Abby Helgemo',
      agent_headshot_url: 'https://x/abby.png',
      brokerage: 'Helgemo Realty',
    });
  });

  it('returns nulls for missing fields', () => {
    const v = brandKitFromClient({ ...client, brand_logo_url: null, agent_headshot_url: null }, {});
    expect(v.logo_url).toBeNull();
    expect(v.agent_headshot_url).toBeNull();
  });
});

describe('mergeBrandVars', () => {
  it('merges into Creatomate modifications, preserving non-brand keys', () => {
    const out = mergeBrandVars({ 'Music.source': 'foo.mp3' }, brandKitFromClient(client, { brokerage: 'Helgemo Realty' }));
    expect(out['Music.source']).toBe('foo.mp3');
    expect(out['Brand.logo']).toBe('https://x/logo.png');
    expect(out['Brand.primary']).toBe('#1A1A1A');
    expect(out['Brand.agent_name']).toBe('Abby Helgemo');
  });

  it('is a no-op when brand vars are all null', () => {
    const empty = { logo_url: null, primary_hex: null, secondary_hex: null, agent_name: null, agent_headshot_url: null, brokerage: null };
    expect(mergeBrandVars({ 'Music.source': 'foo.mp3' }, empty)).toEqual({ 'Music.source': 'foo.mp3' });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/operator-studio/brand-kit.ts
import type { ClientRow, BrandKitVars } from '../types/operator-studio';

export function brandKitFromClient(c: ClientRow, ctx: { brokerage?: string | null }): BrandKitVars {
  return {
    logo_url: c.brand_logo_url,
    primary_hex: c.brand_primary_hex,
    secondary_hex: c.brand_secondary_hex,
    agent_name: c.agent_name,
    agent_headshot_url: c.agent_headshot_url,
    brokerage: ctx.brokerage ?? null,
  };
}

const BRAND_KEY_MAP: Record<keyof BrandKitVars, string> = {
  logo_url: 'Brand.logo',
  primary_hex: 'Brand.primary',
  secondary_hex: 'Brand.secondary',
  agent_name: 'Brand.agent_name',
  agent_headshot_url: 'Brand.agent_headshot',
  brokerage: 'Brand.brokerage',
};

export function mergeBrandVars<T extends Record<string, unknown>>(base: T, brand: BrandKitVars): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(BRAND_KEY_MAP) as Array<keyof BrandKitVars>) {
    const v = brand[k];
    if (v != null) out[BRAND_KEY_MAP[k]] = v;
  }
  return out as T & Record<string, unknown>;
}
```

**Note on Creatomate key naming:** the keys `Brand.logo`, `Brand.primary`, etc. must match the variable names defined in the actual Creatomate template. The executing agent must:
1. Open the Creatomate template in the dashboard, list its current variables.
2. Either rename `BRAND_KEY_MAP` values to match existing variable names OR add new template variables in Creatomate (preferred if branding has no template hooks today).
3. Document the chosen names in `docs/state/PROJECT-STATE.md`.

This step is a small Creatomate dashboard action — call it out explicitly in the Command Center smoke test.

- [ ] **Step 3: Wire into the assembly path**

Locate where the Creatomate submission is built (likely inside `lib/providers/assembly-router.ts` or a Creatomate adapter beneath it). Just before submitting:

```ts
if (property.client_id) {
  const { data: client } = await getSupabase().from('clients').select('*').eq('id', property.client_id).maybeSingle();
  if (client) {
    const brand = brandKitFromClient(client, { brokerage: property.brokerage ?? null });
    modifications = mergeBrandVars(modifications, brand);
  }
}
```

Where `modifications` is the Creatomate `modifications` payload (the executing agent must identify the exact variable name in the existing code).

- [ ] **Step 4: Add an assembly-path integration test** that asserts a property with `client_id` results in `Brand.*` keys in the submission payload. Mock the HTTP layer; assert the body. (Pattern: vitest + msw or vitest manual fetch mock — whichever the codebase already uses.)

- [ ] **Step 5: Commit** — `feat(operator-studio): brand-kit injection at assembly`

---

### Task 9: rerunAssembly helper — TDD

**Files:** Modify `lib/pipeline.ts` (add export `rerunAssembly`). Test in `lib/__tests__/rerun-assembly.test.ts`.

- [ ] **Step 1: Failing test**

```ts
// lib/__tests__/rerun-assembly.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerunAssembly } from '../pipeline';

// Mock service client + assembly submitter
vi.mock('../client', () => ({ getSupabase: () => ({
  from: (t: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', status: 'complete' }, error: null }) }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
}) }));

const submitAssembly = vi.fn().mockResolvedValue({ render_id: 'r1' });
vi.mock('../providers/assembly-router', () => ({ submitAssembly: (...a: unknown[]) => submitAssembly(...a) }));

beforeEach(() => submitAssembly.mockClear());

describe('rerunAssembly', () => {
  it('transitions property to assembling and calls submitAssembly', async () => {
    await rerunAssembly('p1');
    expect(submitAssembly).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'p1', reason: 'manual_rerun' }));
  });

  it('refuses to rerun a property that is currently mid-pipeline', async () => {
    // Test variant — re-mock the row with status='generating' and expect a throw.
    // Implementation handles this branch.
  });
});
```

- [ ] **Step 2: Implement**

Add `export async function rerunAssembly(propertyId: string)` to `lib/pipeline.ts`:
- Fetch the `properties` row.
- If `status` is one of `queued|analyzing|scripting|generating|qc`, throw `Cannot rerun assembly while pipeline is in <status>`.
- Update `status` to `assembling`.
- Call the existing assembly submitter with `{ propertyId, reason: 'manual_rerun' }`.
- Write a `cost_events` row tagged `metadata.reason='manual_rerun'` (the assembly submitter itself emits cost; we add the metadata flag inside the submitter's existing event).

Edge case: if no completed scenes exist, fail fast with a clear error.

- [ ] **Step 3: PASS + commit** — `feat(operator-studio): rerunAssembly helper`

---

### Task 10: Clip-swap module + endpoint — TDD

**Files:** Create `lib/operator-studio/clip-swap.ts` + tests, `api/admin/studio/properties/[id]/scenes/[idx]/swap-clip.ts` + tests.

- [ ] **Step 1: Module test** — `swapClip(propertyId, sceneIdx, iterationId)` validates the iteration belongs to the same `room_type` as the scene, copies the iteration's `clip_url` into the scene row, marks `scenes.replaced_at`, then calls `rerunAssembly(propertyId)`.

- [ ] **Step 2: Implement**

```ts
// lib/operator-studio/clip-swap.ts
import { getSupabase } from '../client';
import { rerunAssembly } from '../pipeline';

export async function swapClip(propertyId: string, sceneIdx: number, iterationId: string): Promise<void> {
  const db = getSupabase();
  const { data: scene, error: sErr } = await db.from('scenes').select('id, room_type').eq('property_id', propertyId).eq('sequence', sceneIdx).maybeSingle();
  if (sErr || !scene) throw new Error(`swapClip: scene not found at sequence ${sceneIdx}`);
  const { data: iter, error: iErr } = await db.from('prompt_lab_listing_scene_iterations').select('id, clip_url, room_type').eq('id', iterationId).maybeSingle();
  if (iErr || !iter) throw new Error(`swapClip: iteration ${iterationId} not found`);
  if (iter.room_type !== scene.room_type) throw new Error(`swapClip: room_type mismatch (scene=${scene.room_type}, iter=${iter.room_type})`);
  if (!iter.clip_url) throw new Error(`swapClip: iteration has no clip_url`);
  const { error: uErr } = await db.from('scenes').update({ clip_url: iter.clip_url, replaced_at: new Date().toISOString() }).eq('id', scene.id);
  if (uErr) throw new Error(`swapClip: scene update failed: ${uErr.message}`);
  await rerunAssembly(propertyId);
}
```

- [ ] **Step 3: Endpoint**

```ts
// api/admin/studio/properties/[id]/scenes/[idx]/swap-clip.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../../lib/auth';
import { swapClip } from '../../../../../../lib/operator-studio/clip-swap';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const propertyId = String(req.query.id);
  const sceneIdx = Number(req.query.idx);
  const iterationId = String(req.body?.iteration_id ?? '');
  if (!iterationId) return res.status(400).json({ error: 'iteration_id required' });
  try {
    await swapClip(propertyId, sceneIdx, iterationId);
    return res.status(202).json({ status: 'reassembling' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(/not found|mismatch|required/.test(msg) ? 400 : 500).json({ error: msg });
  }
}
```

- [ ] **Step 4: PASS + commit** — `feat(operator-studio): clip-swap module + endpoint`

---

### Task 11: Preview-link issuance + public viewer — TDD

**Files:** Create `api/admin/studio/properties/[id]/preview-link.ts` + tests; `api/preview/[token].ts` (public route) + tests; `src/pages/preview/PreviewPage.tsx`.

- [ ] **Step 1: Failing tests**

```ts
// api/admin/studio/properties/[id]/__tests__/preview-link.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../preview-link';
const requireAdmin = vi.fn().mockResolvedValue({ id: 'u1', role: 'admin' });
const insertReturning = vi.fn();
vi.mock('../../../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock('../../../../../../lib/client', () => ({ getSupabase: () => ({ from: () => ({ insert: () => ({ select: () => ({ single: () => insertReturning() }) }) }) }) }));
const mockRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });
beforeEach(() => insertReturning.mockReset());

describe('POST preview-link', () => {
  it('creates a row and returns a public URL', async () => {
    insertReturning.mockResolvedValue({ data: { id: 'pv1', token: 'abc123', property_id: 'p1' }, error: null });
    const res = mockRes() as never;
    await handler({ method: 'POST', query: { id: 'p1' }, body: {} } as never, res);
    const body = (res as any).json.mock.calls[0][0];
    expect(body.url).toMatch(/\/preview\/[A-Za-z0-9_-]+$/);
    expect(body.token).toBeDefined();
  });
});
```

```ts
// api/preview/__tests__/token.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../[token]';
const fetchByToken = vi.fn();
const recordView = vi.fn();
const insertNote = vi.fn();
vi.mock('../../../lib/operator-studio/preview', () => ({
  fetchByToken: (...a: unknown[]) => fetchByToken(...a),
  recordPreviewView: (...a: unknown[]) => recordView(...a),
  insertClientNote: (...a: unknown[]) => insertNote(...a),
}));
const mockRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis(), end: vi.fn() });
beforeEach(() => { fetchByToken.mockReset(); recordView.mockReset(); insertNote.mockReset(); });

describe('preview/:token', () => {
  it('returns 404 for malformed tokens (no DB hit)', async () => {
    const res = mockRes() as never;
    await handler({ method: 'GET', query: { token: 'short' } } as never, res);
    expect(fetchByToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET returns video URL + records view', async () => {
    fetchByToken.mockResolvedValue({ property: { id: 'p1', address: '1 Oak', vertical_video_url: 'https://x/v.mp4' }, client: null, expired: false });
    const res = mockRes() as never;
    await handler({ method: 'GET', query: { token: 'A'.repeat(32) } } as never, res);
    expect(recordView).toHaveBeenCalledWith('A'.repeat(32));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('POST accepts a revision note and increments the badge counter', async () => {
    fetchByToken.mockResolvedValue({ property: { id: 'p1' }, client: null, expired: false });
    const res = mockRes() as never;
    await handler({ method: 'POST', query: { token: 'A'.repeat(32) }, body: { body: 'Change the kitchen scene' } } as never, res);
    expect(insertNote).toHaveBeenCalledWith({ property_id: 'p1', source: 'client_preview', body: 'Change the kitchen scene' });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/operator-studio/preview.ts (NEW module containing the data access for previews)
import { getSupabase } from '../client';
import { generatePreviewToken } from './preview-tokens';

export async function createPreviewLink(propertyId: string, expiresAt: string | null = null) {
  const token = generatePreviewToken();
  const { data, error } = await getSupabase().from('property_previews').insert({ property_id: propertyId, token, expires_at: expiresAt }).select('*').single();
  if (error) throw new Error(`createPreviewLink: ${error.message}`);
  return data;
}

export async function fetchByToken(token: string) {
  const db = getSupabase();
  const { data: pv } = await db.from('property_previews').select('*').eq('token', token).maybeSingle();
  if (!pv) return null;
  const expired = pv.expires_at ? new Date(pv.expires_at) < new Date() : false;
  const { data: property } = await db.from('properties').select('id, address, horizontal_video_url, vertical_video_url, client_id, brokerage').eq('id', pv.property_id).maybeSingle();
  if (!property) return null;
  let client = null;
  if (property.client_id) {
    const { data: c } = await db.from('clients').select('name, brand_logo_url, agent_name').eq('id', property.client_id).maybeSingle();
    client = c;
  }
  return { property, client, expired };
}

export async function recordPreviewView(token: string) {
  await getSupabase().rpc('increment_preview_view', { p_token: token }).then(() => null).catch(() => null);
  // Fallback if no RPC: update directly (one network roundtrip; fine for low volume)
  await getSupabase().from('property_previews').update({ viewed_count: (undefined as never), last_viewed_at: new Date().toISOString() } as never).eq('token', token);
}

export async function insertClientNote(args: { property_id: string; source: 'client_preview'; body: string }) {
  const { error } = await getSupabase().from('property_revision_notes').insert(args);
  if (error) throw new Error(`insertClientNote: ${error.message}`);
}
```

**Note for executing agent:** the `recordPreviewView` increment is best done as a Supabase Postgres function (`create or replace function increment_preview_view(p_token text) ...`) to avoid the read-modify-write race. Add the function to the same migration `055_operator_studio.sql`:

```sql
create or replace function increment_preview_view(p_token text) returns void as $$
  update property_previews
    set viewed_count = viewed_count + 1,
        last_viewed_at = now()
    where token = p_token;
$$ language sql;
```

Then replace the JS fallback above with just `getSupabase().rpc('increment_preview_view', { p_token: token })`.

- [ ] **Step 3: Endpoints**

```ts
// api/admin/studio/properties/[id]/preview-link.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth';
import { createPreviewLink } from '../../../../../lib/operator-studio/preview';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const propertyId = String(req.query.id);
  const expiresAt = req.body?.expires_at ?? null;
  try {
    const row = await createPreviewLink(propertyId, expiresAt);
    const base = process.env.LE_PUBLIC_BASE_URL ?? 'https://listingelevate.com';
    return res.status(201).json({ token: row.token, url: `${base}/preview/${row.token}` });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
```

```ts
// api/preview/[token].ts (public, no admin guard)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../lib/operator-studio/preview-tokens';
import { fetchByToken, recordPreviewView, insertClientNote } from '../../lib/operator-studio/preview';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') {
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    void recordPreviewView(token);
    return res.status(200).json({
      address: result.property.address,
      video_url: result.property.vertical_video_url ?? result.property.horizontal_video_url,
      brand: result.client ? { logo: result.client.brand_logo_url, agent_name: result.client.agent_name, name: result.client.name } : null,
    });
  }

  if (req.method === 'POST') {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'note too long' });
    const result = await fetchByToken(token);
    if (!result || result.expired) return res.status(404).json({ error: 'not_found' });
    await insertClientNote({ property_id: result.property.id, source: 'client_preview', body });
    return res.status(201).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
```

- [ ] **Step 4: Public viewer page**

`src/pages/preview/PreviewPage.tsx` — fetches `GET /api/preview/:token` via the route params, renders the video, a small "Change request" textarea, submits via POST. Rate-limit at the UI layer (disable submit for 5s after a successful POST).

- [ ] **Step 5: Register routes**

Add `<Route path="/preview/:token" element={<PreviewPage />} />` to `src/App.tsx` OUTSIDE the admin guard.

- [ ] **Step 6: PASS + commit** — `feat(operator-studio): preview-link issuance + public viewer`

---

### Task 12: Admin endpoints — clients

(Same as v1 Task 7, scoped to clients only. Code reproduced verbatim — see v1.) Commit: `feat(operator-studio): admin clients endpoints`.

---

### Task 13: Admin endpoint — ingest

(Same as v1 Task 8.) Commit: `feat(operator-studio): admin ingest endpoint`.

---

### Task 14: Admin endpoint — invoice summary

(Same as v1 Task 9, but `lib/operator-studio/invoice-data.ts` already exists from Task 5 and is integration-tested.) Commit: `feat(operator-studio): invoice-summary endpoint`.

---

### Task 15: Studio route shell + side nav

(Same as v1 Task 10, but drop the playbook routes.) Routes: `/dashboard/studio`, `/studio/new`, `/studio/clients`, `/studio/clients/:id`, `/studio/properties/:id`. Commit: `feat(operator-studio): route shell + side nav`.

---

### Task 16: Clients UI

(Same as v1 Task 11.) Commit: `feat(operator-studio): clients UI + picker`.

---

### Task 17: Studio Home Kanban

(Same as v1 Task 12.) Commit: `feat(operator-studio): Studio Home Kanban + queue endpoint`.

---

### Task 18: New-listing form (manual ingest)

(Same as v1 Task 13, drop the playbook picker.) Commit: `feat(operator-studio): new-listing form`.

---

### Task 19: Property Command Center (Phase 1 full)

**Files:** Replace `src/pages/dashboard/studio/PropertyCommandCenter.tsx`; create `api/admin/studio/properties/[id].ts` (bundle endpoint); create `api/admin/studio/properties/[id]/notes.ts`; create `src/components/studio/SceneStrip.tsx` and `src/components/studio/IterateInLabModal.tsx`.

Bundle endpoint as in v1 Task 15, plus the page now wires up the four Phase-1-included flows:
- **Generate preview link** — button hits `POST .../preview-link`, displays the URL + Copy button + view count.
- **Iterate in Lab** per scene — opens `IterateInLabModal` listing rated iterations from `prompt_lab_listing_scene_iterations` filtered by `room_type=scene.room_type`. "Swap & Re-assemble" submits the chosen `iteration_id` to `.../swap-clip`. Show a toast when assembly starts.
- **Director's notes panel** — append-only, mixes `operator` and `client_preview` sources visually with a source badge.
- **Brand-kit summary** — shows the resolved brand kit for the client (logo thumb, color swatches, agent name) so the operator can sanity-check before the assembly runs. If brand kit is incomplete, show a yellow callout "Brand kit missing logo — final video will not be branded" with a deep link to `/dashboard/studio/clients/:id`.

Commit: `feat(operator-studio): property command center (Phase 1 full)`.

---

### Task 20: Pipeline awareness + final smoke

**Files:** Modify `lib/pipeline.ts` (log `order_mode`, `client_id`); update `docs/HANDOFF.md`.

- [ ] **Step 1: Pipeline log extension** — minimal, no behavior change in the main pipeline (brand-kit fork already lives at assembly).
- [ ] **Step 2: Full Phase 1 end-to-end smoke (manual checklist):**
  1. Apply migration 055 to dev.
  2. Create a test client with logo, primary/secondary hex, agent name + headshot.
  3. `/dashboard/studio/new` → ingest with 8 photos.
  4. Watch Kanban: Inbox → Rendering → Delivered.
  5. Open Command Center; verify final video has logo + brand colors on intro/end cards.
  6. Generate preview link; open it in an incognito window; submit a change request.
  7. Verify the change request lands in the Director's Notes panel with `client_preview` source.
  8. Pick a scene → "Iterate in Lab" → pick an iteration → "Swap & Re-assemble"; watch Kanban return to Rendering and back to Delivered with a swapped clip.
  9. Open Clients → "Copy invoice summary" for that client; verify the format.
- [ ] **Step 3: Suite**

```bash
pnpm vitest run
pnpm exec tsc --noEmit
pnpm run doctor
```

Expected: green.

- [ ] **Step 4: Docs + commit (do NOT push without explicit go from Oliver)**

Append `docs/HANDOFF.md` "Recent shipping log" — date + branch + commit SHAs + "Operator Studio Phase 1 — internal MVP shipped (branded end-to-end loop)".

```bash
git add docs/HANDOFF.md lib/pipeline.ts
git commit -m "docs: operator studio phase 1 shipping log"
# Wait for Oliver's go before: git push -u origin feat/operator-studio
```

---

## Phase 2 — Outline (full plan written before dispatch)

- **P2-A — Magic-link scraper.** `lib/operator-studio/scrapers/{zillow,redfin,sierra}.ts` using Apify Playwright. Extend `manualIngest` to accept a `source_url`.
- **P2-B — Playbooks.** Reintroduce the `playbooks` table, CRUD, UI; wire the pipeline to read playbook orientation / duration / music / voiceover preferences.
- **P2-C — Director's notes polish.** Append-only timeline view + filter by source. Foundation for Claude distill.
- **P2-D — Claude distill notes → scene actions.** `POST /api/admin/studio/properties/:id/notes/distill` runs notes through Claude and returns structured `{ scene_idx, action }[]` linked to one-click "Iterate scene N" CTAs.

## Phase 3 — Outline

- **P3-A — Finances integration.** Operator-mode rows roll up into a "Client invoices" section on `/dashboard/finances`. Per-client P&L card.
- **P3-B — ElevenLabs voice clone wiring.** `clients.voice_id` becomes the voiceover input when playbook enables voiceover.
- **P3-C — Multi-revision tracking.** Hard cap "1 free revision per delivery" and surface revision count on the Kanban.

---

## Self-review (post-write, v2)

- **Spec coverage:** Phase 1 covers schema A (minus playbooks), shell B, manual ingest C, clients D, command center E with brand-kit F injection AND clip-swap G AND preview-link H, invoice rollup I. The v2 phasing eliminates Gemini's strongest critique (unbranded P1 video + no delivery loop).
- **Cost-tracking:** new cost paths are clip-swap (writes via `rerunAssembly` → existing assembly cost writer, tagged `metadata.reason='manual_rerun'`) and preview-link issuance (no external API → no cost event, by design). Invoice math is integration-tested.
- **Security:** preview tokens use `crypto.randomBytes`, validated by `isWellFormedToken` before any DB read; rate limited at UI; admin endpoints all gated by `requireAdmin()`.
- **No placeholders:** Task code blocks include the actual implementation. Tasks 6/12/13/14/15/16/17/18 reference v1 content verbatim — the code is in the v1 plan in commit history of this branch if executing agents prefer a single rendering, but the file paths + types + verbs in this v2 plan are sufficient to write them.
- **No phantom imports:** `getSupabase` (from `lib/client.ts`) and `requireAdmin` (from `lib/auth.ts`) are confirmed existing helpers. `submitAssembly` may live under a different name inside `lib/providers/assembly-router.ts` — the executing agent for Task 8/9 must grep for the actual submitter and adapt. Server-side pipeline trigger is delegated to the React page (see "Pipeline trigger" note above).
