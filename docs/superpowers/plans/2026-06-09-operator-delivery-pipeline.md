# Operator Delivery Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two workstreams per the approved spec (`docs/superpowers/specs/2026-06-09-operator-delivery-pipeline-design.md`): (W1) fix the silently-empty client picker, enrich the client editor with brokerage / formatted phone / Creatomate template-coverage; (W2) a stage-machine-driven operator delivery pipeline — intake → Redfin scrape → A/B clip generation → Gemini judging → checkpoint A → details → Sonnet voiceover → voice + music → Creatomate assembly → checkpoint B — with every operator action captured in `ml_events` and every external call writing `cost_events`.

**Architecture:** New `delivery_runs` / `scene_variants` / `ml_events` tables (migration 077, service-role-only RLS per migration-062 pattern). Pure stage machine in `lib/delivery/state.ts`; thin CRUD in `lib/delivery/runs.ts`; one dynamic admin route `api/admin/studio/delivery/[runId].ts` (GET bundle / PATCH details / POST `{action}` dispatch) registered in `vercel.json`. The existing customer pipeline is untouched except for three **gated** hooks: (a) `runGenerationSubmit` submits a second variant per scene only when a delivery run exists, (b) `api/cron/poll-scenes.ts` polls pending `scene_variants` and, when a delivery run exists, runs the judge pass instead of auto-`runAssembly`, (c) `runAssemblyStep` honors `delivery_runs.scene_order` only when a run with an order exists. Assembly itself reuses `rerunAssembly()` by writing run state (winner clips, music_track_id, voiceover URL, listing details) back onto `properties`/`scenes` first. Customer flow (`order_mode='customer'`, no delivery run) stays byte-identical.

**Tech Stack:** Vite + React 18 SPA (`src/`), Vercel serverless functions (`api/`, legacy `routes` in `vercel.json` — every new dynamic api path needs a rewrite), shared Supabase (service role via `lib/client.ts getSupabase()`), Vitest (`npm test`; tests colocated as `*.test.ts` next to lib files or in `__tests__/` dirs — both patterns exist, this plan uses `__tests__/` for new api tests and colocated `.test.ts` for new lib files), Anthropic SDK (`claude-sonnet-4-6` script-gen / `claude-haiku-4-5-20251001` parsing, costs via `lib/utils/claude-cost.ts computeClaudeCost`), `@google/genai` Gemini (`gemini-2.5-flash`, cost via `geminiCostCents` exported from `lib/providers/gemini-judge.ts`), ElevenLabs TTS (`lib/voiceover/generate-audio.ts`) + Music (`lib/providers/elevenlabs-music.ts`), Apify Redfin (`lib/mls/scrape-redfin.ts scrapeRedfinByAddress`), Creatomate (`lib/providers/creatomate.ts`, `getTemplate()` at lines 663–694).

---

## Canonical strings (locked — reuse VERBATIM in every task)

**Stage enum** (`delivery_runs.stage`, `lib/delivery/state.ts DELIVERY_STAGES`):

```
'intake','scraping','generating','judging','checkpoint_a','details','voiceover','music','assembling','checkpoint_b','delivered'
```

**Video types** (`delivery_runs.video_type`): `'just_listed','just_pended','just_closed'`

**ml_events.event_type**:

```
'reorder','regenerate','variant_override','script_edit','voice_choice','music_choice','rating','comment','details_edit'
```

(`details_edit` is an addition to the spec's 8-value enum: the spec's Stage-5 text requires "edits logged" but its enum has no type for it. Locked here.)

**winner_source**: `'gemini','operator'` · **variant**: `'A','B'`

**Feedback tag categories** (comment parser): `'pacing','voice_tone','clip_quality','music_fit','script_style','other'`

**cost_events conventions** (existing TS union in `lib/db.ts recordCostEvent` is closed — do NOT invent new stage/provider values):
- A/B variant render → `stage:'generation'`, provider = video provider name, `metadata:{delivery_run_id, scene_id, variant:'B'}` (A is recorded by the existing scene path)
- Gemini A/B judge → `stage:'qc'`, `provider:'google'`, `metadata:{delivery_run_id, scene_id, subtype:'ab_judge', ...}`
- Sonnet voiceover script → `stage:'scripting'`, `provider:'anthropic'`, `metadata:{delivery_run_id, subtype:'delivery_voiceover_script', ...}`
- Haiku comment parse → `stage:'analysis'`, `provider:'anthropic'`, `metadata:{delivery_run_id, subtype:'feedback_parse', ...}`
- ElevenLabs music gen → recorded inside `composeMusic` (stage `'assembly'`); pass `propertyId` so it attributes, and ALSO insert run id by wrapping (see Task 19)
- ElevenLabs TTS → recorded inside `generateVoiceoverAudio` (stage `'assembly'`)
- Redfin scrape → recorded inside `scrapeRedfinByAddress` (stage `'scripting'`, provider `'apify'`)

**Migration numbering:** `075_creatives.sql` already exists on this branch. W1 schema = **076**, W2 schema = **077**. Every migration task ends with: *apply via Supabase (service-role REST/MCP) before dependent tasks run.* Repo has **no** generic `updated_at` trigger convention (verified: `clients.ts` sets `updated_at` explicitly in `updateClient`; 064 just defaults `now()`) — new lib code sets `updated_at` explicitly on UPDATE, no triggers.

**Conventions every task obeys:**
- TDD for all lib logic: write the failing test first, run it, watch it fail, implement, watch it pass.
- `npx vitest run <file>` for single files; `npm test` for the suite. Known pre-existing failure: `src/v2/components/landing/MarketComparison.test.tsx` (stale copy test) — not ours; `src/lib/studio/__tests__/extract-photos` may fail if `jszip` isn't installed in this worktree (env-only).
- `npx vite build` before any "done"/push claim (tsc misses Tailwind/PostCSS errors).
- Commit after every task: conventional-commit message ending with a blank line then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No JetBrains Mono / no monospace UI text (CLAUDE.md rule). All new UI uses `.studio-*` classes + `--le-*` tokens like the existing studio pages.
- Admin api routes: `requireAdmin(req,res)` from `lib/auth.js`, early-return on null, `{ error: 'method_not_allowed' }` 405 fallback — copy `api/admin/studio/clients/index.ts` shape.
- Frontend API calls: `authedFetch` from `@/lib/api` (attaches the Supabase Bearer token — **never** bare `fetch`, that's the W1 bug).

---

# Workstream 1 — Client fix

## Task 1: Diagnose + fix the empty client picker (missing auth header) + error/retry UI

**Root cause (verified during planning):** `src/components/studio/ClientPicker.tsx:39` calls bare `fetch('/api/admin/studio/clients')` with no `Authorization` header. `lib/auth.ts verifyAuth` (line 28) only accepts `Authorization: Bearer <token>` — there is no cookie path. The API returns `401 {"error":"Unauthorized"}`, and line 41's `setClients(d.clients ?? [])` renders that as an empty list. The Clients **page** (`src/pages/dashboard/studio/Clients.tsx:47`) uses `authedFetch` and works — only the picker regressed (during the dashboard-rebuild reskin, per its own header comment "Preserves existing logic"). The vercel.json route table is NOT the problem: the filesystem handler serves `api/admin/studio/clients/index.ts` at `/api/admin/studio/clients` (same as `api/admin/subscriptions/index.ts`, which has no rewrite and works).

**Files:**
- Modify: `src/components/studio/ClientPicker.tsx` (whole fetch block, lines 36–42)
- Test: manual reproduction + `npx vite build` (component is a styled select; repo has no ClientPicker test and the fix is a fetch-wiring change verified by reproduction)

**Steps:**

- [ ] Reproduce the failure to confirm the diagnosis before changing anything:
  ```bash
  curl -s https://listingelevate.com/api/admin/studio/clients | head -c 200
  ```
  Expected output: `{"error":"Unauthorized"}` (proves the route resolves and rejects unauthenticated requests — the picker is sending exactly this request). If you instead get HTML, the route table IS broken and you must also add `{ "src": "/api/admin/studio/clients", "dest": "/api/admin/studio/clients/index" }` to `vercel.json` routes above the `clients/([^/]+)` rewrite — but the curl above should return the JSON 401.
- [ ] Rewrite the data-fetch portion of `ClientPicker.tsx` (keep the existing styled `<select>` markup and props untouched):
  ```tsx
  import { useCallback, useEffect, useState } from 'react';
  import { ChevronDown, RefreshCw } from 'lucide-react';
  import { authedFetch } from '@/lib/api';
  ```
  ```tsx
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
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
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
  ```
  Below the `<select>` wrapper `<div>`, render the error + retry state (errors can never masquerade as "no clients" again):
  ```tsx
  {loadError && (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: 'var(--le-bad, #b42318)' }}>
        Couldn't load clients: {loadError}
      </span>
      <button type="button" className="studio-btn-ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={() => void loadClients()}>
        <RefreshCw size={11} strokeWidth={1.8} /> Retry
      </button>
    </div>
  )}
  ```
  While `loading`, show `<option value="">Loading clients…</option>` instead of the placeholder option.
- [ ] Run `npx vite build` — expect `✓ built` exit 0.
- [ ] Verify in the app (dev server or preview): `/dashboard/studio/video/new` client dropdown now lists Brian Helgemo's client row; with devtools network throttled to offline + a remount, the red error + Retry appears.
- [ ] Commit:
  ```bash
  git add src/components/studio/ClientPicker.tsx
  git commit -m "fix(studio): client picker sends auth header + surfaces fetch errors with retry

The picker used bare fetch() with no Authorization Bearer header, so
requireAdmin 401'd and 'd.clients ?? []' rendered the error as an empty
list. Switch to authedFetch and add visible error + retry state.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 2: `lib/utils/phone.ts` pure formatter (TDD)

**Files:**
- Create: `lib/utils/phone.ts`
- Test: `lib/utils/__tests__/phone.test.ts` (matches existing `lib/utils/__tests__/` dir)

**Steps:**

- [ ] Write the failing test `lib/utils/__tests__/phone.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { normalizePhone, formatPhoneDisplay, formatAsYouType } from '../phone';

  describe('normalizePhone', () => {
    it('strips everything but digits', () => {
      expect(normalizePhone('(941) 205-9011')).toBe('9412059011');
    });
    it('drops a leading US country code 1 on 11-digit numbers', () => {
      expect(normalizePhone('+1 941 205 9011')).toBe('9412059011');
    });
    it('passes through short fragments', () => {
      expect(normalizePhone('941')).toBe('941');
    });
  });

  describe('formatPhoneDisplay', () => {
    it('renders 10 digits as (941) 205-9011', () => {
      expect(formatPhoneDisplay('9412059011')).toBe('(941) 205-9011');
    });
    it('formats already-decorated input', () => {
      expect(formatPhoneDisplay('941.205.9011')).toBe('(941) 205-9011');
    });
    it('returns non-10-digit input unchanged', () => {
      expect(formatPhoneDisplay('12345')).toBe('12345');
    });
    it('returns null for null/empty', () => {
      expect(formatPhoneDisplay(null)).toBeNull();
      expect(formatPhoneDisplay('')).toBeNull();
    });
  });

  describe('formatAsYouType', () => {
    it('opens paren from the first digit', () => {
      expect(formatAsYouType('9')).toBe('(9');
    });
    it('closes area code at 4+ digits', () => {
      expect(formatAsYouType('9412')).toBe('(941) 2');
    });
    it('adds the dash at 7+ digits', () => {
      expect(formatAsYouType('9412059')).toBe('(941) 205-9');
    });
    it('caps at 10 digits', () => {
      expect(formatAsYouType('94120590113333')).toBe('(941) 205-9011');
    });
    it('empty input stays empty', () => {
      expect(formatAsYouType('')).toBe('');
    });
  });
  ```
- [ ] Run `npx vitest run lib/utils/__tests__/phone.test.ts` — expect FAIL: `Cannot find module '../phone'` (or equivalent resolve error).
- [ ] Create `lib/utils/phone.ts`:
  ```ts
  /**
   * Pure phone helpers for client records.
   * Storage convention: clients.phone is saved digits-only (10 digits for US).
   * Display convention: "(941) 205-9011" — used in the client editor, Command
   * Center, and the Creatomate Brand.phone / Text-Phone-Number modifications.
   */

  /** Digits only; drops a leading US "1" from 11-digit numbers. */
  export function normalizePhone(input: string): string {
    const digits = input.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits;
  }

  /** "(941) 205-9011" for 10-digit numbers; non-10-digit input returned as-is. */
  export function formatPhoneDisplay(input: string | null | undefined): string | null {
    if (!input) return null;
    const d = normalizePhone(input);
    if (d.length !== 10) return input;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  /** Progressive mask for text inputs: "(9" → "(941) 2" → "(941) 205-9011". */
  export function formatAsYouType(input: string): string {
    const d = normalizePhone(input).slice(0, 10);
    if (d.length === 0) return '';
    if (d.length < 4) return `(${d}`;
    if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  ```
- [ ] Run `npx vitest run lib/utils/__tests__/phone.test.ts` — expect 12 passing.
- [ ] Commit:
  ```bash
  git add lib/utils/phone.ts lib/utils/__tests__/phone.test.ts
  git commit -m "feat(utils): pure phone normalizer + display + as-you-type formatters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 3: Migration 076 (`clients.brokerage`) + brand-kit Brand.phone + client editor fields

**Files:**
- Create: `supabase/migrations/076_clients_brokerage.sql`
- Modify: `lib/types/operator-studio.ts` (ClientRow, line 3–19), `lib/operator-studio/brand-kit.ts` (whole file), `src/components/studio/ClientPicker.tsx` (local ClientRow type, line 4–20), `src/pages/dashboard/studio/ClientEdit.tsx` (form state ~line 25–47, load ~119–145, save ~196–215, fields ~351–470)
- Test: `lib/operator-studio/__tests__/brand-kit.test.ts` (create)

**Steps:**

- [ ] Write the migration `supabase/migrations/076_clients_brokerage.sql` (full SQL):
  ```sql
  -- 076: clients.brokerage — per-client brokerage label for brand-kit injection.
  -- Brand-kit precedence: clients.brokerage → properties.brokerage → null.
  -- (clients.agent_name remains the display name; no new display-name column.)

  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS brokerage text;
  ```
  **Apply via Supabase (service-role REST/MCP) before dependent tasks run.** Additive-only; shared DB across envs — safe.
- [ ] Add `brokerage: string | null;` to `ClientRow` in `lib/types/operator-studio.ts` (after `notes`), and the same to the local `ClientRow` interface in `src/components/studio/ClientPicker.tsx`.
- [ ] Write the failing test `lib/operator-studio/__tests__/brand-kit.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { brandKitFromClient, mergeBrandVars } from '../brand-kit';
  import type { ClientRow } from '../../types/operator-studio';

  const baseClient: ClientRow = {
    id: 'c1', name: 'Helgemo Team', contact_email: null, phone: '9412059011',
    monthly_rate_cents: null, notes: null, brand_logo_url: 'https://x/logo.png',
    brand_primary_hex: '#112233', brand_secondary_hex: null,
    agent_name: 'Brian Helgemo', agent_headshot_url: 'https://x/head.jpg',
    voice_id: null, brokerage: 'RE/MAX Harbor Realty', archived_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  };

  describe('brandKitFromClient', () => {
    it('prefers clients.brokerage over the property brokerage', () => {
      const kit = brandKitFromClient(baseClient, { brokerage: 'Property Brokerage LLC' });
      expect(kit.brokerage).toBe('RE/MAX Harbor Realty');
    });
    it('falls back to properties.brokerage when client has none', () => {
      const kit = brandKitFromClient({ ...baseClient, brokerage: null }, { brokerage: 'Property Brokerage LLC' });
      expect(kit.brokerage).toBe('Property Brokerage LLC');
    });
    it('formats phone for display', () => {
      const kit = brandKitFromClient(baseClient, { brokerage: null });
      expect(kit.phone).toBe('(941) 205-9011');
    });
  });

  describe('mergeBrandVars', () => {
    it('writes Brand.phone AND Text-Phone-Number.text', () => {
      const kit = brandKitFromClient(baseClient, { brokerage: null });
      const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator phone' }, kit);
      expect(out['Brand.phone']).toBe('(941) 205-9011');
      expect(out['Text-Phone-Number.text']).toBe('(941) 205-9011'); // client wins over operator-derived base
    });
    it('null brand values do NOT clobber base keys', () => {
      const kit = brandKitFromClient({ ...baseClient, phone: null }, { brokerage: null });
      const out = mergeBrandVars({ 'Text-Phone-Number.text': 'operator phone' }, kit);
      expect(out['Text-Phone-Number.text']).toBe('operator phone');
    });
  });
  ```
- [ ] Run `npx vitest run lib/operator-studio/__tests__/brand-kit.test.ts` — expect FAIL (brokerage precedence is currently `ctx.brokerage ?? null`; `Brand.phone` key missing; phone unformatted).
- [ ] Update `lib/operator-studio/brand-kit.ts`:
  ```ts
  import type { ClientRow, BrandKitVars } from '../types/operator-studio.js';
  import { formatPhoneDisplay } from '../utils/phone.js';

  export function brandKitFromClient(c: ClientRow, ctx: { brokerage?: string | null }): BrandKitVars {
    return {
      logo_url: c.brand_logo_url,
      primary_hex: c.brand_primary_hex,
      secondary_hex: c.brand_secondary_hex,
      agent_name: c.agent_name,
      agent_headshot_url: c.agent_headshot_url,
      // Precedence (migration 076): client's own brokerage → property brokerage.
      brokerage: c.brokerage ?? ctx.brokerage ?? null,
      phone: formatPhoneDisplay(c.phone),
    };
  }
  ```
  and in `BRAND_KEY_MAP` change the phone row to:
  ```ts
  phone: ['Brand.phone', 'Text-Phone-Number.text'],
  ```
  (everything else in the file unchanged).
- [ ] Run `npx vitest run lib/operator-studio/__tests__/brand-kit.test.ts` — expect 5 passing. Also run `npx vitest run lib/__tests__` and `npx vitest run lib/assembly` to confirm no pipeline/brand regressions.
- [ ] Update `src/pages/dashboard/studio/ClientEdit.tsx`:
  - Add `brokerage: string;` to `ClientFormState` + `EMPTY_FORM` (`brokerage: ''`), load it in the fetch effect (`brokerage: c.brokerage ?? ''`), save it in the PATCH/POST payload (`brokerage: form.brokerage.trim() || null`).
  - Add a "Brokerage" text field directly under the existing agent-name field: `<FieldLabel>Brokerage</FieldLabel><input className="studio-input" value={form.brokerage} onChange={(e) => setField('brokerage', e.target.value)} placeholder="RE/MAX Harbor Realty" />` with hint text "Shown on videos. Falls back to the listing's brokerage when blank."
  - Relabel the agent-name field's `<FieldLabel>` to `Display name (shown on videos)` (the field stays bound to `agent_name`).
  - Phone field: `onChange={(e) => setField('phone', formatAsYouType(e.target.value))}` (import `formatAsYouType, normalizePhone` from `../../../../lib/utils/phone`), and save digits-only: `phone: normalizePhone(form.phone) || null`.
- [ ] `npx vite build` — expect exit 0. Manually verify the editor loads/saves brokerage + formats phone as you type.
- [ ] Commit:
  ```bash
  git add supabase/migrations/076_clients_brokerage.sql lib/types/operator-studio.ts lib/operator-studio/brand-kit.ts lib/operator-studio/__tests__/brand-kit.test.ts src/components/studio/ClientPicker.tsx src/pages/dashboard/studio/ClientEdit.tsx
  git commit -m "feat(studio): clients.brokerage (076) + Brand.phone injection + editor brokerage/phone fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 4: Creatomate template-coverage panel

**Files:**
- Create: `api/admin/studio/template-coverage.ts` (flat file — filesystem-routed, no vercel.json change needed)
- Create: `api/admin/studio/__tests__/template-coverage.test.ts`
- Modify: `src/pages/dashboard/studio/ClientEdit.tsx` (new Section after Brand kit)

**Steps:**

- [ ] Write the failing test `api/admin/studio/__tests__/template-coverage.test.ts` (mock pattern copied from `api/admin/studio/clients/__tests__/index.test.ts`):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import type { VercelRequest, VercelResponse } from '@vercel/node';

  const mockRequireAdmin = vi.fn();
  const mockGetTemplate = vi.fn();

  vi.mock('../../../../lib/auth', () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock('../../../../lib/providers/creatomate', () => ({
    CreatomateProvider: class {
      getTemplate(id: string) { return mockGetTemplate(id); }
    },
  }));

  import handler from '../template-coverage';

  function makeRes() {
    return {
      _status: 0, _body: {} as unknown,
      status(code: number) { this._status = code; return this; },
      json(body: unknown) { this._body = body; return this; },
    };
  }
  const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };

  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockGetTemplate.mockReset();
    process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 = 'tpl-15';
    delete process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED;
    delete process.env.CREATOMATE_TEMPLATE_ID_JUST_PENDED;
    delete process.env.CREATOMATE_TEMPLATE_ID_JUST_CLOSED;
    delete process.env.CREATOMATE_TEMPLATE_ID_LIFE_CYCLE;
    delete process.env.CREATOMATE_TEMPLATE_ID_DEFAULT;
  });

  it('returns per-template dynamic field lists for configured env template ids', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetTemplate.mockResolvedValue({
      name: '15 seconds - Just Listed', width: 1280, height: 720,
      elements: [
        { name: 'Text-Phone-Number', type: 'text', dynamic: ['text'] },
        { name: 'Image-Headshot', type: 'image', dynamic: ['source'] },
        { name: 'Static-BG', type: 'shape', dynamic: [] },
      ],
    });
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { templates: Array<{ env_var: string; template_id: string; name: string; fields: string[] }> };
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].env_var).toBe('CREATOMATE_TEMPLATE_ID_JUST_LISTED_15');
    expect(body.templates[0].fields).toEqual(['Text-Phone-Number.text', 'Image-Headshot.source']);
  });

  it('reports a fetch failure per-template instead of 500ing the whole panel', async () => {
    mockRequireAdmin.mockResolvedValue(adminUser);
    mockGetTemplate.mockRejectedValue(new Error('Creatomate template fetch failed: 404'));
    const res = makeRes();
    await handler({ method: 'GET', query: {}, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    const body = res._body as { templates: Array<{ error?: string }> };
    expect(body.templates[0].error).toMatch(/404/);
  });
  ```
- [ ] Run `npx vitest run api/admin/studio/__tests__/template-coverage.test.ts` — expect FAIL (module not found).
- [ ] Create `api/admin/studio/template-coverage.ts`:
  ```ts
  import type { VercelRequest, VercelResponse } from '@vercel/node';
  import { requireAdmin } from '../../../lib/auth.js';
  import { CreatomateProvider } from '../../../lib/providers/creatomate.js';

  // Env vars the template resolver reads (lib/assembly/template-resolver.ts).
  const TEMPLATE_ENV_VARS = [
    'CREATOMATE_TEMPLATE_ID_JUST_LISTED_15',
    'CREATOMATE_TEMPLATE_ID_JUST_LISTED',
    'CREATOMATE_TEMPLATE_ID_JUST_PENDED',
    'CREATOMATE_TEMPLATE_ID_JUST_CLOSED',
    'CREATOMATE_TEMPLATE_ID_LIFE_CYCLE',
    'CREATOMATE_TEMPLATE_ID_DEFAULT',
  ] as const;

  export default async function handler(req: VercelRequest, res: VercelResponse) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const provider = new CreatomateProvider();
    const templates = await Promise.all(
      TEMPLATE_ENV_VARS
        .map((envVar) => ({ envVar, templateId: process.env[envVar] }))
        .filter((t): t is { envVar: string; templateId: string } => Boolean(t.templateId))
        .map(async ({ envVar, templateId }) => {
          try {
            const tpl = await provider.getTemplate(templateId);
            // "Brand.phone"-style dynamic fields: element name + each dynamic property.
            const fields = tpl.elements.flatMap((e) => e.dynamic.map((d) => `${e.name}.${d}`));
            return { env_var: envVar, template_id: templateId, name: tpl.name, fields };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { env_var: envVar, template_id: templateId, name: null, fields: [], error: msg };
          }
        }),
    );
    return res.status(200).json({ templates });
  }
  ```
- [ ] Run `npx vitest run api/admin/studio/__tests__/template-coverage.test.ts` — expect 2 passing.
- [ ] Add the coverage panel to `src/pages/dashboard/studio/ClientEdit.tsx` as a new `studio-card` section ("Template coverage") rendered only when `!isNew`. Logic (client-side, no new test file — verified by build + manual check):
  ```tsx
  // Brand keys the pipeline can inject (mirror of BRAND_KEY_MAP in lib/operator-studio/brand-kit.ts)
  const BRAND_FIELD_SOURCES: Array<{ label: string; templateKeys: string[]; hasValue: (f: ClientFormState) => boolean }> = [
    { label: 'Logo',       templateKeys: ['Brand.logo'],                                   hasValue: (f) => !!f.brand_logo_url },
    { label: 'Primary',    templateKeys: ['Brand.primary'],                                hasValue: (f) => !!f.brand_primary_hex },
    { label: 'Secondary',  templateKeys: ['Brand.secondary'],                              hasValue: (f) => !!f.brand_secondary_hex },
    { label: 'Name',       templateKeys: ['Brand.agent_name', 'Text-Agent-Name.text'],     hasValue: (f) => !!f.agent_name },
    { label: 'Headshot',   templateKeys: ['Brand.agent_headshot', 'Image-Headshot.source'],hasValue: (f) => !!(f.agent_headshot_url) },
    { label: 'Brokerage',  templateKeys: ['Brand.brokerage', 'Text-Brokerage-Team.text'],  hasValue: (f) => !!f.brokerage },
    { label: 'Phone',      templateKeys: ['Brand.phone', 'Text-Phone-Number.text'],        hasValue: (f) => !!f.phone },
  ];
  ```
  Fetch `authedFetch('/api/admin/studio/template-coverage')` once on mount (state: `coverage`, `coverageError`). For each returned template render a sub-block with the template name and one badge per `BRAND_FIELD_SOURCES` row: **green** (`var(--le-good)`) when `templateKeys.some(k => fields.includes(k))` AND `hasValue(form)`; **amber** when the template wants it but the client value is empty; **gray** when the client has a value but the template exposes no matching placeholder (this is the known missing-`Brand.*`-placeholder gap — label gray badges "no placeholder in template"). Badges are plain `<span>`s with `.studio-status-pill`-like inline styles; Inter only.
- [ ] `npx vite build` — exit 0. Manual check on a client edit page: panel renders, the 15s template shows green for phone/headshot/name/brokerage (it has the `Text-*` keys), gray rows surface the missing `Brand.*` placeholders.
- [ ] Commit:
  ```bash
  git add api/admin/studio/template-coverage.ts api/admin/studio/__tests__/template-coverage.test.ts src/pages/dashboard/studio/ClientEdit.tsx
  git commit -m "feat(studio): Creatomate template-coverage endpoint + client editor coverage badges

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

# Workstream 2 — Delivery pipeline

## Task 5: Migration 077 — `delivery_runs`, `scene_variants`, `ml_events`

**Files:**
- Create: `supabase/migrations/077_delivery_pipeline.sql`
- Modify: `lib/types/operator-studio.ts` (append row types)

**Steps:**

- [ ] Create `supabase/migrations/077_delivery_pipeline.sql` (full SQL — enums as CHECK constraints, matching the 062/064 repo convention; no updated_at triggers — lib code sets it, matching `updateClient`):
  ```sql
  -- 077: Operator delivery pipeline — delivery_runs + scene_variants + ml_events.
  -- Spec: docs/superpowers/specs/2026-06-09-operator-delivery-pipeline-design.md
  -- RLS: service-role only (no policies), same posture as migration 062 tables.

  create table if not exists delivery_runs (
    id uuid primary key default gen_random_uuid(),
    property_id uuid not null references properties(id) on delete cascade,
    client_id uuid references clients(id) on delete set null,
    video_type text not null default 'just_listed'
      check (video_type in ('just_listed','just_pended','just_closed')),
    duration_seconds integer,
    stage text not null default 'intake'
      check (stage in ('intake','scraping','generating','judging','checkpoint_a','details','voiceover','music','assembling','checkpoint_b','delivered')),
    -- { price, beds, baths, sqft, mls_description, source: 'scraped'|'manual' }
    listing_details jsonb not null default '{}'::jsonb,
    -- Ordered array of scene UUIDs — the draft/operator clip order for assembly.
    scene_order jsonb,
    voiceover_script text,
    voiceover_voice_id text,
    voiceover_audio_url text,
    music_track_id uuid references music_tracks(id),
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists idx_delivery_runs_property on delivery_runs(property_id);
  create index if not exists idx_delivery_runs_stage on delivery_runs(stage);

  create table if not exists scene_variants (
    id uuid primary key default gen_random_uuid(),
    delivery_run_id uuid not null references delivery_runs(id) on delete cascade,
    scene_id uuid not null references scenes(id) on delete cascade,
    variant text not null check (variant in ('A','B')),
    provider text,
    provider_task_id text,
    clip_url text,
    cost_cents integer,
    gemini_scores jsonb,
    winner boolean not null default false,
    winner_source text check (winner_source in ('gemini','operator')),
    degraded boolean not null default false,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (scene_id, variant)
  );
  create index if not exists idx_scene_variants_run on scene_variants(delivery_run_id);
  -- Poll queue: submitted but not yet collected.
  create index if not exists idx_scene_variants_pending on scene_variants(provider_task_id)
    where provider_task_id is not null and clip_url is null and error is null;

  create table if not exists ml_events (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references delivery_runs(id) on delete cascade,
    event_type text not null
      check (event_type in ('reorder','regenerate','variant_override','script_edit','voice_choice','music_choice','rating','comment','details_edit')),
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create index if not exists idx_ml_events_run on ml_events(run_id, created_at desc);

  -- Service-role-only: enable RLS with NO policies (migration 062 pattern).
  alter table delivery_runs enable row level security;
  alter table scene_variants enable row level security;
  alter table ml_events enable row level security;
  ```
  **Apply via Supabase (service-role REST/MCP) before dependent tasks run.** Additive-only.
- [ ] Append row types to `lib/types/operator-studio.ts`:
  ```ts
  export type DeliveryVideoType = 'just_listed' | 'just_pended' | 'just_closed';

  export type ListingDetails = {
    price?: number | null;
    beds?: number | null;
    baths?: number | null;
    sqft?: number | null;
    mls_description?: string | null;
    source?: 'scraped' | 'manual';
  };

  export type DeliveryRunRow = {
    id: string;
    property_id: string;
    client_id: string | null;
    video_type: DeliveryVideoType;
    duration_seconds: number | null;
    stage: string; // DeliveryStage — narrowed via lib/delivery/state.ts
    listing_details: ListingDetails;
    scene_order: string[] | null;
    voiceover_script: string | null;
    voiceover_voice_id: string | null;
    voiceover_audio_url: string | null;
    music_track_id: string | null;
    error: string | null;
    created_at: string;
    updated_at: string;
  };

  export type SceneVariantRow = {
    id: string;
    delivery_run_id: string;
    scene_id: string;
    variant: 'A' | 'B';
    provider: string | null;
    provider_task_id: string | null;
    clip_url: string | null;
    cost_cents: number | null;
    gemini_scores: Record<string, unknown> | null;
    winner: boolean;
    winner_source: 'gemini' | 'operator' | null;
    degraded: boolean;
    error: string | null;
    created_at: string;
    updated_at: string;
  };

  export type MlEventType =
    | 'reorder' | 'regenerate' | 'variant_override' | 'script_edit'
    | 'voice_choice' | 'music_choice' | 'rating' | 'comment' | 'details_edit';

  export type MlEventRow = {
    id: string;
    run_id: string;
    event_type: MlEventType;
    payload: Record<string, unknown>;
    created_at: string;
  };
  ```
- [ ] Run `npx tsc --noEmit -p tsconfig.json` (or `npx vite build`) — clean.
- [ ] Commit:
  ```bash
  git add supabase/migrations/077_delivery_pipeline.sql lib/types/operator-studio.ts
  git commit -m "feat(delivery): migration 077 — delivery_runs + scene_variants + ml_events (service-role RLS)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 6: `lib/delivery/state.ts` — pure stage machine (TDD)

**Files:**
- Create: `lib/delivery/state.ts`
- Test: `lib/delivery/state.test.ts` (colocated, like `lib/assembly/music.test.ts`)

**Steps:**

- [ ] Write the failing test `lib/delivery/state.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { DELIVERY_STAGES, nextStage, canAdvance, isDeliveryStage, stageIndex } from './state';

  describe('DELIVERY_STAGES', () => {
    it('is the locked 11-stage sequence', () => {
      expect(DELIVERY_STAGES).toEqual([
        'intake', 'scraping', 'generating', 'judging', 'checkpoint_a',
        'details', 'voiceover', 'music', 'assembling', 'checkpoint_b', 'delivered',
      ]);
    });
  });

  describe('nextStage', () => {
    it('walks the chain', () => {
      expect(nextStage('intake')).toBe('scraping');
      expect(nextStage('checkpoint_a')).toBe('details');
      expect(nextStage('checkpoint_b')).toBe('delivered');
    });
    it('terminal stage has no next', () => {
      expect(nextStage('delivered')).toBeNull();
    });
  });

  describe('canAdvance', () => {
    it('allows only single forward steps', () => {
      expect(canAdvance('judging', 'checkpoint_a')).toBe(true);
      expect(canAdvance('intake', 'generating')).toBe(false); // no skipping
      expect(canAdvance('details', 'checkpoint_a')).toBe(false); // no going back
      expect(canAdvance('delivered', 'intake')).toBe(false);
    });
  });

  describe('isDeliveryStage / stageIndex', () => {
    it('guards and indexes', () => {
      expect(isDeliveryStage('voiceover')).toBe(true);
      expect(isDeliveryStage('nonsense')).toBe(false);
      expect(stageIndex('intake')).toBe(0);
      expect(stageIndex('delivered')).toBe(10);
    });
  });
  ```
- [ ] Run `npx vitest run lib/delivery/state.test.ts` — expect FAIL (module not found).
- [ ] Create `lib/delivery/state.ts`:
  ```ts
  /**
   * Operator delivery stage machine — pure, no I/O.
   * Stage values are the migration-077 CHECK constraint, verbatim.
   * All transitions are single forward steps; retries re-run a stage's
   * side effect without moving the pointer (handled in runs.ts).
   */

  export const DELIVERY_STAGES = [
    'intake', 'scraping', 'generating', 'judging', 'checkpoint_a',
    'details', 'voiceover', 'music', 'assembling', 'checkpoint_b', 'delivered',
  ] as const;

  export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

  export function isDeliveryStage(s: string): s is DeliveryStage {
    return (DELIVERY_STAGES as readonly string[]).includes(s);
  }

  export function stageIndex(s: DeliveryStage): number {
    return DELIVERY_STAGES.indexOf(s);
  }

  export function nextStage(s: DeliveryStage): DeliveryStage | null {
    const i = stageIndex(s);
    return i >= 0 && i < DELIVERY_STAGES.length - 1 ? DELIVERY_STAGES[i + 1] : null;
  }

  /** True only for the single legal forward step from `from`. */
  export function canAdvance(from: DeliveryStage, to: DeliveryStage): boolean {
    return nextStage(from) === to;
  }
  ```
- [ ] Run `npx vitest run lib/delivery/state.test.ts` — expect 7 passing.
- [ ] Commit:
  ```bash
  git add lib/delivery/state.ts lib/delivery/state.test.ts
  git commit -m "feat(delivery): pure stage machine (11 locked stages, single-step transitions)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 7: `lib/delivery/runs.ts` CRUD + `api/admin/studio/delivery/[runId].ts` route + vercel.json rewrite

**Files:**
- Create: `lib/delivery/runs.ts`
- Create: `lib/delivery/runs.test.ts`
- Create: `api/admin/studio/delivery/[runId].ts`
- Create: `api/admin/studio/delivery/__tests__/runId.test.ts`
- Modify: `vercel.json` (routes array — insert before the `/api/admin/studio/clients/([^/]+)` line)
- Modify: `api/admin/studio/properties/[id].ts` (add delivery_run + variants to the bundle)

**Steps:**

- [ ] Write the failing lib test `lib/delivery/runs.test.ts` (mocked supabase chain — the transition guard must reject BEFORE any DB write):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const updateSpy = vi.fn();
  const mockChain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'insert', 'update', 'eq', 'order', 'maybeSingle', 'single']) {
    mockChain[m] = vi.fn().mockReturnValue(mockChain);
  }
  vi.mock('../client.js', () => ({ getSupabase: () => mockChain }));

  import { advanceRun, recordMlEvent } from './runs';

  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of Object.keys(mockChain)) (mockChain[m] as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
    (mockChain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'judging' }, error: null });
    (mockChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'r1', stage: 'checkpoint_a' }, error: null });
    void updateSpy;
  });

  describe('advanceRun', () => {
    it('rejects an illegal transition without writing', async () => {
      await expect(advanceRun('r1', 'voiceover')).rejects.toThrow(/illegal transition/i);
      expect(mockChain.update).not.toHaveBeenCalled();
    });
    it('advances a legal single step', async () => {
      const row = await advanceRun('r1', 'checkpoint_a');
      expect(row.stage).toBe('checkpoint_a');
      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'checkpoint_a', error: null }),
      );
    });
  });

  describe('recordMlEvent', () => {
    it('rejects unknown event types', async () => {
      // @ts-expect-error — runtime guard test
      await expect(recordMlEvent('r1', 'bogus', {})).rejects.toThrow(/event_type/i);
      expect(mockChain.insert).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] Run `npx vitest run lib/delivery/runs.test.ts` — expect FAIL (module not found).
- [ ] Create `lib/delivery/runs.ts`:
  ```ts
  import { getSupabase } from '../client.js';
  import { canAdvance, isDeliveryStage, type DeliveryStage } from './state.js';
  import type { DeliveryRunRow, ListingDetails, MlEventRow, MlEventType, SceneVariantRow, DeliveryVideoType } from '../types/operator-studio.js';

  const ML_EVENT_TYPES: readonly MlEventType[] = [
    'reorder', 'regenerate', 'variant_override', 'script_edit',
    'voice_choice', 'music_choice', 'rating', 'comment', 'details_edit',
  ];

  export async function createRun(input: {
    property_id: string;
    client_id: string | null;
    video_type: DeliveryVideoType;
    duration_seconds: number | null;
  }): Promise<DeliveryRunRow> {
    const { data, error } = await getSupabase()
      .from('delivery_runs')
      .insert({ ...input, stage: 'intake' })
      .select('*')
      .single();
    if (error) throw new Error(`createRun: ${error.message}`);
    return data as DeliveryRunRow;
  }

  export async function getRun(runId: string): Promise<DeliveryRunRow | null> {
    const { data, error } = await getSupabase().from('delivery_runs').select('*').eq('id', runId).maybeSingle();
    if (error) throw new Error(`getRun: ${error.message}`);
    return (data as DeliveryRunRow | null) ?? null;
  }

  export async function getRunByProperty(propertyId: string): Promise<DeliveryRunRow | null> {
    const { data, error } = await getSupabase().from('delivery_runs').select('*').eq('property_id', propertyId).maybeSingle();
    if (error) throw new Error(`getRunByProperty: ${error.message}`);
    return (data as DeliveryRunRow | null) ?? null;
  }

  export async function getVariantsForRun(runId: string): Promise<SceneVariantRow[]> {
    const { data, error } = await getSupabase()
      .from('scene_variants').select('*').eq('delivery_run_id', runId).order('created_at', { ascending: true });
    if (error) throw new Error(`getVariantsForRun: ${error.message}`);
    return (data ?? []) as SceneVariantRow[];
  }

  export async function getEventsForRun(runId: string): Promise<MlEventRow[]> {
    const { data, error } = await getSupabase()
      .from('ml_events').select('*').eq('run_id', runId).order('created_at', { ascending: false });
    if (error) throw new Error(`getEventsForRun: ${error.message}`);
    return (data ?? []) as MlEventRow[];
  }

  /** Patch arbitrary run columns (listing_details, scripts, choices…). Always bumps updated_at. */
  export async function updateRun(runId: string, patch: Partial<DeliveryRunRow>): Promise<DeliveryRunRow> {
    const { data, error } = await getSupabase()
      .from('delivery_runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', runId)
      .select('*')
      .single();
    if (error) throw new Error(`updateRun: ${error.message}`);
    return data as DeliveryRunRow;
  }

  /** Single-step stage advance, guarded by the pure state machine. Clears error. */
  export async function advanceRun(runId: string, to: string): Promise<DeliveryRunRow> {
    if (!isDeliveryStage(to)) throw new Error(`advanceRun: '${to}' is not a delivery stage`);
    const run = await getRun(runId);
    if (!run) throw new Error(`advanceRun: run not found: ${runId}`);
    const from = run.stage as DeliveryStage;
    if (!canAdvance(from, to)) {
      throw new Error(`advanceRun: illegal transition ${from} -> ${to}`);
    }
    return updateRun(runId, { stage: to, error: null } as Partial<DeliveryRunRow>);
  }

  /** Stage failed: keep the pointer, surface the error for per-stage retry UI. */
  export async function setRunError(runId: string, message: string): Promise<DeliveryRunRow> {
    return updateRun(runId, { error: message } as Partial<DeliveryRunRow>);
  }

  /** Retry = clear the error; the caller re-fires the stage's side effect. */
  export async function clearRunError(runId: string): Promise<DeliveryRunRow> {
    return updateRun(runId, { error: null } as Partial<DeliveryRunRow>);
  }

  export async function recordMlEvent(
    runId: string,
    eventType: MlEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!ML_EVENT_TYPES.includes(eventType)) {
      throw new Error(`recordMlEvent: unknown event_type '${eventType}'`);
    }
    const { error } = await getSupabase().from('ml_events').insert({ run_id: runId, event_type: eventType, payload });
    if (error) throw new Error(`recordMlEvent: ${error.message}`);
  }

  /** Listing-details merge helper used by PATCH + scrape. */
  export async function setListingDetails(
    runId: string,
    details: ListingDetails,
  ): Promise<DeliveryRunRow> {
    return updateRun(runId, { listing_details: details } as Partial<DeliveryRunRow>);
  }
  ```
- [ ] Run `npx vitest run lib/delivery/runs.test.ts` — expect 3 passing.
- [ ] Write the failing route test `api/admin/studio/delivery/__tests__/runId.test.ts` (same harness as `clients/__tests__/index.test.ts` — mock `requireAdmin` + the runs lib; cover: 401, GET 200 bundle `{run, variants, events}`, GET 404, POST `{action:'advance', to:'details'}` calls `advanceRun`, POST advance with illegal transition → 400 with the error message, POST `{action:'retry'}` calls `clearRunError`, unknown action → 400, PUT → 405):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import type { VercelRequest, VercelResponse } from '@vercel/node';

  const mockRequireAdmin = vi.fn();
  const libMocks = {
    getRun: vi.fn(), getVariantsForRun: vi.fn(), getEventsForRun: vi.fn(),
    advanceRun: vi.fn(), clearRunError: vi.fn(), setRunError: vi.fn(),
    updateRun: vi.fn(), recordMlEvent: vi.fn(), setListingDetails: vi.fn(),
  };
  vi.mock('../../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a) }));
  vi.mock('../../../../../lib/delivery/runs', () => libMocks);

  import handler from '../[runId]';

  function makeRes() {
    return {
      _status: 0, _body: {} as unknown,
      status(code: number) { this._status = code; return this; },
      json(body: unknown) { this._body = body; return this; },
    };
  }
  const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };
  const run = { id: 'r1', property_id: 'p1', stage: 'checkpoint_a' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(adminUser);
    libMocks.getRun.mockResolvedValue(run);
    libMocks.getVariantsForRun.mockResolvedValue([]);
    libMocks.getEventsForRun.mockResolvedValue([]);
  });

  it('GET returns the run bundle', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { run: unknown }).run).toEqual(run);
  });

  it('GET 404s on unknown run', async () => {
    libMocks.getRun.mockResolvedValue(null);
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'rX' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });

  it('POST advance delegates to advanceRun', async () => {
    libMocks.advanceRun.mockResolvedValue({ ...run, stage: 'details' });
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'details' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(libMocks.advanceRun).toHaveBeenCalledWith('r1', 'details');
    expect(res._status).toBe(200);
  });

  it('POST advance surfaces illegal transitions as 400', async () => {
    libMocks.advanceRun.mockRejectedValue(new Error('advanceRun: illegal transition checkpoint_a -> music'));
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'music' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('POST unknown action -> 400; PUT -> 405', async () => {
    const res1 = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'nope' } } as unknown as VercelRequest, res1 as unknown as VercelResponse);
    expect(res1._status).toBe(400);
    const res2 = makeRes();
    await handler({ method: 'PUT', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res2 as unknown as VercelResponse);
    expect(res2._status).toBe(405);
  });
  ```
- [ ] Run `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts` — expect FAIL.
- [ ] Create `api/admin/studio/delivery/[runId].ts` (the action dispatcher grows in later tasks — this task ships GET + `advance` + `retry`):
  ```ts
  import type { VercelRequest, VercelResponse } from '@vercel/node';
  import { requireAdmin } from '../../../../lib/auth.js';
  import {
    getRun, getVariantsForRun, getEventsForRun,
    advanceRun, clearRunError,
  } from '../../../../lib/delivery/runs.js';

  export const maxDuration = 300; // scrape/regenerate/assemble actions run long

  export default async function handler(req: VercelRequest, res: VercelResponse) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const runId = String(req.query.runId);

    try {
      if (req.method === 'GET') {
        const run = await getRun(runId);
        if (!run) return res.status(404).json({ error: 'not_found' });
        const [variants, events] = await Promise.all([
          getVariantsForRun(runId),
          getEventsForRun(runId),
        ]);
        return res.status(200).json({ run, variants, events });
      }

      if (req.method === 'POST') {
        const action = String(req.body?.action ?? '');
        switch (action) {
          case 'advance': {
            const run = await advanceRun(runId, String(req.body?.to ?? ''));
            return res.status(200).json({ run });
          }
          case 'retry': {
            const run = await clearRunError(runId);
            return res.status(200).json({ run });
          }
          // Later tasks add: 'scrape' (T8), 'reorder' (T14), 'regenerate'/'flip_winner' (T15),
          // 'generate_script'/'set_script' (T17), 'set_voice'/'generate_audio' (T18),
          // 'set_music'/'generate_music' (T19), 'assemble' (T20), 'submit_ratings' (T21).
          default:
            return res.status(400).json({ error: `unknown action '${action}'` });
        }
      }

      // PATCH (listing details) lands in Task 9.
      return res.status(405).json({ error: 'method_not_allowed' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(/illegal transition|not a delivery stage|required|invalid|unknown/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  }
  ```
- [ ] Run `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts` — expect 5 passing.
- [ ] Register the rewrite in `vercel.json` (legacy routes mode — dynamic api paths NEED this). Insert directly ABOVE the `"/api/admin/studio/clients/([^/]+)"` line:
  ```json
  { "src": "/api/admin/studio/delivery/([^/]+)", "dest": "/api/admin/studio/delivery/[runId]?runId=$1" },
  ```
- [ ] Extend the Command Center bundle: in `api/admin/studio/properties/[id].ts` add to the `Promise.all` array:
  ```ts
  db.from('delivery_runs').select('*').eq('property_id', id).maybeSingle(),
  ```
  destructure it as `dRes`, and add `delivery_run: dRes.data ?? null` to the JSON response. (Variants/events come from the delivery route — the bundle only needs the run for stepper rendering.)
- [ ] `npx vite build` — exit 0. Commit:
  ```bash
  git add lib/delivery/runs.ts lib/delivery/runs.test.ts "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts vercel.json "api/admin/studio/properties/[id].ts"
  git commit -m "feat(delivery): runs CRUD + guarded advance + delivery API route + bundle wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 8: Intake — video_type selector, run creation on ingest, async Redfin scrape

**Files:**
- Modify: `lib/types/operator-studio.ts` (ManualIngestInput, ~line 27), `lib/operator-studio/ingest.ts` (manualIngest, after property insert ~line 133), `src/pages/dashboard/studio/StudioNew.tsx` (state ~line 122, payload ~line 263–273, selector markup after the Duration block ~line 486, post-submit kick ~line 281–283)
- Create: `lib/delivery/scrape.ts`
- Modify: `api/admin/studio/delivery/[runId].ts` (add `scrape` action)
- Test: `api/admin/studio/__tests__/ingest.test.ts` (extend existing), `lib/delivery/scrape.test.ts` (create)

**Steps:**

- [ ] Add to `ManualIngestInput` in `lib/types/operator-studio.ts`:
  ```ts
  video_type?: 'just_listed' | 'just_pended' | 'just_closed' | null;
  ```
- [ ] Extend the existing `api/admin/studio/__tests__/ingest.test.ts` with a failing assertion that `manualIngest` result is returned unchanged when `video_type` is present (the route passes body through — confirm no 400). Then in `lib/operator-studio/ingest.ts`:
  - Destructure `video_type` from input.
  - Map it onto the property insert: `selected_package: video_type ?? selected_package ?? 'just_listed',`
  - After the photos insert (step 2), create the delivery run (every studio ingest is `order_mode:'operator'` → operator mode == run exists):
    ```ts
    // 4. Operator delivery run (spec 2026-06-09). Non-fatal: a run-create
    // failure must not lose the ingested property — surface in logs instead.
    try {
      const { createRun } = await import('../delivery/runs.js');
      await createRun({
        property_id: propertyId,
        client_id: client_id ?? null,
        video_type: video_type ?? 'just_listed',
        duration_seconds: selected_duration ?? 30,
      });
    } catch (err) {
      console.error('[ingest] delivery_run create failed:', err);
    }
    ```
- [ ] Write the failing test `lib/delivery/scrape.test.ts` for the mapping function (pure part):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { listingDetailsFromRedfin } from './scrape';

  it('maps a Redfin result to listing_details with source=scraped', () => {
    expect(listingDetailsFromRedfin({
      source: 'redfin', address: '470 Sorrento Ct, Punta Gorda, FL, 33950',
      price: 899000, bedrooms: 3, bathrooms: 2, sqft: 1823,
      agent: 'A. Gent', description: 'Waterfront pool home.', listingUrl: 'https://www.redfin.com/x',
    })).toEqual({
      price: 899000, beds: 3, baths: 2, sqft: 1823,
      mls_description: 'Waterfront pool home.', source: 'scraped',
    });
  });

  it('null result maps to empty details (manual-entry state)', () => {
    expect(listingDetailsFromRedfin(null)).toEqual({ source: 'scraped' });
  });
  ```
- [ ] Run `npx vitest run lib/delivery/scrape.test.ts` — expect FAIL. Create `lib/delivery/scrape.ts`:
  ```ts
  import { scrapeRedfinByAddress, type RedfinScrapeResult } from '../mls/scrape-redfin.js';
  import { getRun, setListingDetails, setRunError, advanceRun } from './runs.js';
  import { getSupabase } from '../client.js';
  import type { ListingDetails } from '../types/operator-studio.js';

  export function listingDetailsFromRedfin(r: RedfinScrapeResult | null): ListingDetails {
    if (!r) return { source: 'scraped' };
    return {
      price: r.price, beds: r.bedrooms, baths: r.bathrooms, sqft: r.sqft,
      mls_description: r.description, source: 'scraped',
    };
  }

  /**
   * Stage side effect for 'scraping'. Never a blocker: a miss or error leaves
   * listing_details empty (amber manual-entry state in the UI), notes the
   * error on the run, and STILL advances to 'generating' so the pipeline
   * (kicked in parallel by StudioNew) is never gated on Redfin.
   * scrapeRedfinByAddress records its own apify cost_event.
   */
  export async function runScrapeStage(runId: string): Promise<void> {
    const run = await getRun(runId);
    if (!run) throw new Error(`runScrapeStage: run not found: ${runId}`);
    if (run.stage === 'intake') await advanceRun(runId, 'scraping');

    const { data: prop } = await getSupabase()
      .from('properties').select('address').eq('id', run.property_id).maybeSingle();

    try {
      const result = await scrapeRedfinByAddress(String(prop?.address ?? ''), run.property_id);
      await setListingDetails(runId, listingDetailsFromRedfin(result));
      if (!result) await setRunError(runId, 'Redfin scrape returned no listing — enter details manually.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setRunError(runId, `Redfin scrape failed: ${msg} — enter details manually.`);
    }

    // Advance regardless of scrape outcome (resumable; details editable later).
    const after = await getRun(runId);
    if (after?.stage === 'scraping') await advanceRun(runId, 'generating');
  }
  ```
- [ ] Run `npx vitest run lib/delivery/scrape.test.ts` — expect 2 passing.
- [ ] Add the `scrape` action to `api/admin/studio/delivery/[runId].ts` switch:
  ```ts
  case 'scrape': {
    const { runScrapeStage } = await import('../../../../lib/delivery/scrape.js');
    await runScrapeStage(runId);
    const run = await getRun(runId);
    return res.status(200).json({ run });
  }
  ```
- [ ] `src/pages/dashboard/studio/StudioNew.tsx`:
  - State: `const [videoType, setVideoType] = useState<'just_listed' | 'just_pended' | 'just_closed'>('just_listed');`
  - Selector: copy the existing Video-length 3-button group (lines 455–486) verbatim into a new "Video type" block directly above it, mapping `(['just_listed','just_pended','just_closed'] as const)` with labels `Just Listed` / `Just Pended` / `Just Closed`, active state on `videoType`.
  - Payload: add `video_type: videoType,` next to `selected_duration`.
  - Post-submit (after the existing `fetch('/api/pipeline/${property_id}', …)` kick at line 282): fetch the new run id from the bundle and fire the scrape, both fire-and-forget:
    ```ts
    authedFetch(`/api/admin/studio/properties/${property_id}`)
      .then((r) => r.json())
      .then((b) => {
        const runId = b.delivery_run?.id;
        if (runId) {
          return authedFetch(`/api/admin/studio/delivery/${runId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'scrape' }),
          });
        }
      })
      .catch(() => {}); // scrape is never a blocker
    ```
- [ ] Run `npx vitest run api/admin/studio/__tests__/ingest.test.ts api/admin/studio/delivery/__tests__/runId.test.ts` — all pass. `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add lib/types/operator-studio.ts lib/operator-studio/ingest.ts lib/delivery/scrape.ts lib/delivery/scrape.test.ts "api/admin/studio/delivery/[runId].ts" src/pages/dashboard/studio/StudioNew.tsx api/admin/studio/__tests__/ingest.test.ts
  git commit -m "feat(delivery): intake video_type + run creation on ingest + async Redfin scrape stage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 9: Manual listing-details entry (PATCH + validation + details_edit event)

**Files:**
- Create: `lib/delivery/details.ts`, `lib/delivery/details.test.ts`
- Modify: `api/admin/studio/delivery/[runId].ts` (PATCH branch)
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Write the failing test `lib/delivery/details.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { validateListingDetails } from './details';

  it('accepts a full valid payload', () => {
    const r = validateListingDetails({ price: 899000, beds: 3, baths: 2.5, sqft: 1823, mls_description: 'Nice.' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.details).toEqual({ price: 899000, beds: 3, baths: 2.5, sqft: 1823, mls_description: 'Nice.', source: 'manual' });
  });
  it('accepts partial payloads (nulls allowed — never a blocker)', () => {
    const r = validateListingDetails({ price: null, beds: null, baths: null, sqft: null, mls_description: null });
    expect(r.ok).toBe(true);
  });
  it('rejects negative numbers and non-numeric strings', () => {
    expect(validateListingDetails({ price: -5 }).ok).toBe(false);
    expect(validateListingDetails({ beds: 'three' as unknown as number }).ok).toBe(false);
  });
  ```
- [ ] Run `npx vitest run lib/delivery/details.test.ts` — FAIL. Create `lib/delivery/details.ts`:
  ```ts
  import type { ListingDetails } from '../types/operator-studio.js';

  type Result = { ok: true; details: ListingDetails } | { ok: false; error: string };

  function num(v: unknown, field: string): number | null | string {
    if (v == null || v === '') return null;
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return `${field} must be a non-negative number`;
    return v;
  }

  /** Manual entry validation. Partial payloads OK; bad values rejected. */
  export function validateListingDetails(input: Record<string, unknown>): Result {
    const out: ListingDetails = { source: 'manual' };
    for (const field of ['price', 'beds', 'baths', 'sqft'] as const) {
      const v = num(input[field], field);
      if (typeof v === 'string') return { ok: false, error: v };
      if (v !== null) out[field] = v;
      else out[field] = null;
    }
    const desc = input.mls_description;
    if (desc != null && typeof desc !== 'string') return { ok: false, error: 'mls_description must be a string' };
    out.mls_description = (desc as string | null) ?? null;
    return { ok: true, details: out };
  }
  ```
- [ ] `npx vitest run lib/delivery/details.test.ts` — 3 passing.
- [ ] Add the PATCH branch to `api/admin/studio/delivery/[runId].ts` (replace the `// PATCH … Task 9` placeholder position, before the 405 fallback):
  ```ts
  if (req.method === 'PATCH') {
    const { validateListingDetails } = await import('../../../../lib/delivery/details.js');
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const v = validateListingDetails(req.body ?? {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { setListingDetails, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const updated = await setListingDetails(runId, v.details);
    await recordMlEvent(runId, 'details_edit', { before: run.listing_details, after: v.details });
    return res.status(200).json({ run: updated });
  }
  ```
- [ ] Extend the route test: PATCH with `{price: 899000}` → 200 + `setListingDetails` called + `recordMlEvent('r1','details_edit', …)`; PATCH `{price: -1}` → 400. Run `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts` — all pass.
- [ ] Commit:
  ```bash
  git add lib/delivery/details.ts lib/delivery/details.test.ts "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts
  git commit -m "feat(delivery): manual listing-details PATCH with validation + details_edit ml_event

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 10: A/B generation — variant submission + cron polling

**Files:**
- Create: `lib/delivery/variants.ts`, `lib/delivery/variants.test.ts`
- Modify: `lib/pipeline.ts` (end of `runGenerationSubmit`, after the `Promise.all` worker pool at line 999–1001), `api/cron/poll-scenes.ts` (after the per-scene loop, before the finalize loop ~line 325)

**Steps:**

- [ ] Write the failing test `lib/delivery/variants.test.ts` for the pure degradation helper:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { variantPairStatus } from './variants';

  const v = (over: Record<string, unknown>) => ({
    id: 'x', delivery_run_id: 'r1', scene_id: 's1', variant: 'A', provider: 'atlas',
    provider_task_id: 't', clip_url: null, cost_cents: null, gemini_scores: null,
    winner: false, winner_source: null, degraded: false, error: null,
    created_at: '', updated_at: '', ...over,
  });

  describe('variantPairStatus', () => {
    it('pending while either variant is in flight', () => {
      expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B' }))).toBe('pending');
    });
    it('ready when both clips landed', () => {
      expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B', clip_url: 'b.mp4' }))).toBe('ready');
    });
    it('degraded when B errored and A landed', () => {
      expect(variantPairStatus(v({ clip_url: 'a.mp4' }), v({ variant: 'B', error: 'submit failed', provider_task_id: null }))).toBe('degraded');
    });
    it('degraded when B is missing entirely', () => {
      expect(variantPairStatus(v({ clip_url: 'a.mp4' }), null)).toBe('degraded');
    });
    it('failed when neither produced a clip and nothing is in flight', () => {
      expect(variantPairStatus(v({ error: 'x', provider_task_id: null }), v({ variant: 'B', error: 'y', provider_task_id: null }))).toBe('failed');
    });
  });
  ```
- [ ] Run `npx vitest run lib/delivery/variants.test.ts` — FAIL. Create `lib/delivery/variants.ts`:
  ```ts
  import { getSupabase } from '../client.js';
  import { recordCostEvent, log } from '../db.js';
  import { selectProviderForScene, buildProviderFromDecision, selectProvider } from '../providers/router.js';
  import type { SceneVariantRow } from '../types/operator-studio.js';
  import type { RoomType, CameraMovement, VideoProvider, PipelineMode } from '../types.js';

  type PairStatus = 'pending' | 'ready' | 'degraded' | 'failed';

  /** In flight = task submitted, no clip yet, no terminal error. */
  function inFlight(v: SceneVariantRow | null): boolean {
    return Boolean(v && v.provider_task_id && !v.clip_url && !v.error);
  }
  function landed(v: SceneVariantRow | null): boolean {
    return Boolean(v && v.clip_url);
  }

  /** Pure pair classifier — drives the judge gate + the degraded flag. */
  export function variantPairStatus(a: SceneVariantRow | null, b: SceneVariantRow | null): PairStatus {
    if (inFlight(a) || inFlight(b)) return 'pending';
    if (landed(a) && landed(b)) return 'ready';
    if (landed(a) || landed(b)) return 'degraded';
    return 'failed';
  }

  /**
   * Called from runGenerationSubmit AFTER the variant-A (scenes-table) submits.
   * Inserts an 'A' row mirroring each submitted scene, then submits ONE extra
   * provider run per scene as variant 'B' (same prompt — Kling output variance
   * differentiates). A B-submit failure degrades that scene to single-clip
   * (degraded=true on the B row); it never blocks the run.
   */
  export async function submitVariantsForProperty(propertyId: string, runId: string): Promise<void> {
    const supabase = getSupabase();
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id, scene_number, photo_id, prompt, duration_seconds, camera_movement, provider, provider_task_id, end_photo_id, end_image_url')
      .eq('property_id', propertyId)
      .not('provider_task_id', 'is', null);

    let pipelineMode: PipelineMode = 'v1';
    const { data: prop } = await supabase.from('properties').select('pipeline_mode').eq('id', propertyId).maybeSingle();
    pipelineMode = ((prop?.pipeline_mode as PipelineMode | null) ?? 'v1');

    for (const scene of scenes ?? []) {
      // Variant A mirrors the scene's own submission; clip syncs in the judge pass.
      await supabase.from('scene_variants').upsert({
        delivery_run_id: runId, scene_id: scene.id, variant: 'A',
        provider: scene.provider, provider_task_id: scene.provider_task_id,
      }, { onConflict: 'scene_id,variant' });

      // Variant B: an independent second render of the same prompt.
      const { data: photo } = await supabase.from('photos').select('file_url, room_type').eq('id', scene.photo_id).single();
      try {
        if (!photo) throw new Error('source photo not found');
        const decision = selectProviderForScene(
          {
            endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
            movement: (scene.camera_movement as CameraMovement | null) ?? null,
            roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
            preference: (scene.provider as VideoProvider | null) ?? null,
          },
          [],
          pipelineMode,
        );
        const provider = buildProviderFromDecision(decision);
        const genJob = await provider.generateClip({
          sourceImage: Buffer.alloc(0),
          sourceImageUrl: (photo as { file_url: string }).file_url,
          prompt: scene.prompt as string,
          durationSeconds: scene.duration_seconds,
          aspectRatio: '16:9',
          endImageUrl: (scene as { end_image_url?: string | null }).end_image_url ?? undefined,
          modelOverride: decision.modelKey,
        });
        await supabase.from('scene_variants').upsert({
          delivery_run_id: runId, scene_id: scene.id, variant: 'B',
          provider: provider.name, provider_task_id: genJob.jobId,
        }, { onConflict: 'scene_id,variant' });
        await log(propertyId, 'generation', 'info',
          `Scene ${scene.scene_number}: variant B submitted to ${provider.name}`,
          { jobId: genJob.jobId, delivery_run_id: runId }, scene.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase.from('scene_variants').upsert({
          delivery_run_id: runId, scene_id: scene.id, variant: 'B',
          error: msg, degraded: true,
        }, { onConflict: 'scene_id,variant' });
        await log(propertyId, 'generation', 'warn',
          `Scene ${scene.scene_number}: variant B submit failed (degrading to single clip): ${msg}`,
          { delivery_run_id: runId }, scene.id);
      }
    }
  }

  /**
   * Cron tick: poll pending B-variant tasks, download finished clips into
   * property-videos storage, record generation cost_events with the run id.
   * Mirrors api/cron/poll-scenes.ts's per-scene path (provider reconstructed
   * by name via selectProvider).
   */
  export async function pollPendingVariants(limit = 15): Promise<{ polled: number; completed: number; failed: number }> {
    const supabase = getSupabase();
    const { data: pending } = await supabase
      .from('scene_variants')
      .select('id, delivery_run_id, scene_id, variant, provider, provider_task_id, created_at')
      .not('provider_task_id', 'is', null)
      .is('clip_url', null)
      .is('error', null)
      .eq('variant', 'B')
      .limit(limit);

    let completed = 0, failed = 0;
    for (const v of pending ?? []) {
      const { data: scene } = await supabase
        .from('scenes').select('property_id, scene_number, duration_seconds').eq('id', v.scene_id).single();
      if (!scene || !v.provider) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = selectProvider('other', null, v.provider as any, []);
        if (provider.name !== v.provider) {
          await supabase.from('scene_variants')
            .update({ error: `provider ${v.provider} no longer available`, degraded: true, updated_at: new Date().toISOString() })
            .eq('id', v.id);
          failed++;
          continue;
        }
        const status = await provider.checkStatus(v.provider_task_id as string);
        if (status.status === 'processing') continue;
        if (status.status === 'failed' || !status.videoUrl) {
          await supabase.from('scene_variants')
            .update({ error: status.error ?? 'render failed', degraded: true, updated_at: new Date().toISOString() })
            .eq('id', v.id);
          await recordCostEvent({
            propertyId: scene.property_id, sceneId: v.scene_id, stage: 'generation',
            provider: v.provider as Parameters<typeof recordCostEvent>[0]['provider'],
            unitsConsumed: 1, costCents: v.provider === 'kling' ? 0 : (status.costCents ?? 0),
            metadata: { delivery_run_id: v.delivery_run_id, variant: 'B', render_outcome: 'failed', source: 'cron' },
          }).catch((e) => console.error('[delivery/variants] cost_event failed:', e));
          failed++;
          continue;
        }
        const clipBuffer = await provider.downloadClip(status.videoUrl);
        const clipPath = `${scene.property_id}/variants/scene_${scene.scene_number}_B.mp4`;
        const { error: upErr } = await supabase.storage
          .from('property-videos').upload(clipPath, clipBuffer, { contentType: 'video/mp4', upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('property-videos').getPublicUrl(clipPath);
        const costCents = status.costCents ?? 0;
        await supabase.from('scene_variants')
          .update({ clip_url: urlData.publicUrl, cost_cents: costCents, updated_at: new Date().toISOString() })
          .eq('id', v.id);
        await recordCostEvent({
          propertyId: scene.property_id, sceneId: v.scene_id, stage: 'generation',
          provider: v.provider as Parameters<typeof recordCostEvent>[0]['provider'],
          unitsConsumed: status.providerUnits ?? 1, unitType: status.providerUnitType ?? null,
          costCents,
          metadata: { delivery_run_id: v.delivery_run_id, variant: 'B', duration_seconds: scene.duration_seconds, source: 'cron' },
        }).catch((e) => console.error('[delivery/variants] cost_event failed:', e));
        completed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(scene.property_id, 'generation', 'warn',
          `Variant B poll failed for scene ${scene.scene_number}: ${msg}`, { delivery_run_id: v.delivery_run_id }, v.scene_id);
      }
    }
    return { polled: (pending ?? []).length, completed, failed };
  }
  ```
  (Note: `status.costCents ?? 0` — the kling/runway fallback estimates from poll-scenes lines 159–178 apply only to those providers; replicate the same `fallbackCents` block if `provider.name === 'runway' || provider.name === 'kling'`, copying lines 162–178 of `api/cron/poll-scenes.ts` verbatim so B-variant costs are never silently 0 for those providers.)
- [ ] `npx vitest run lib/delivery/variants.test.ts` — 5 passing.
- [ ] Hook into `lib/pipeline.ts runGenerationSubmit` — after `await Promise.all(...)` (line 999–1001) and before the `submittedScenes` recount, insert:
  ```ts
  // Operator delivery A/B (spec 2026-06-09): when a delivery run exists,
  // submit a second independent render per scene for pairwise judging.
  // Gated read — customer flow (no run) is byte-identical.
  try {
    const { data: deliveryRun } = await supabase
      .from('delivery_runs').select('id').eq('property_id', propertyId).maybeSingle();
    if (deliveryRun) {
      const { submitVariantsForProperty } = await import('./delivery/variants.js');
      await submitVariantsForProperty(propertyId, deliveryRun.id as string);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(propertyId, 'generation', 'warn', `A/B variant submission failed (non-fatal): ${msg}`);
  }
  ```
- [ ] Hook into `api/cron/poll-scenes.ts` — directly after the `for (const scene of pending)` loop closes (line 324), insert:
  ```ts
  // Operator delivery: poll pending B-variant renders (no-op when none exist).
  try {
    const { pollPendingVariants } = await import('../../lib/delivery/variants.js');
    await pollPendingVariants();
  } catch (err) {
    console.error('[poll-scenes] variant polling failed:', err);
  }
  ```
- [ ] Run `npm test` (full) — same pass count as baseline plus new tests; `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add lib/delivery/variants.ts lib/delivery/variants.test.ts lib/pipeline.ts api/cron/poll-scenes.ts
  git commit -m "feat(delivery): A/B scene variants — gated dual submission + cron polling + degradation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 11: Gemini A/B judge + cron gate (skip auto-assembly for delivery runs)

**Files:**
- Create: `lib/delivery/judge.ts`, `lib/delivery/judge.test.ts`
- Modify: `api/cron/poll-scenes.ts` (finalize loop, before the `runAssembly` call ~line 376)

**Steps:**

- [ ] Write the failing test `lib/delivery/judge.test.ts` (pure winner selection — never trust the model's own `winner` field):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { scoreTotal, pickWinner, parseJudgeJson } from './judge';

  const s = (motion: number, artifacts: number, realism: number, composition: number) =>
    ({ motion_quality: motion, artifacts, realism, composition });

  describe('scoreTotal', () => {
    it('sums the four rubric dimensions', () => {
      expect(scoreTotal(s(4, 3, 5, 4))).toBe(16);
    });
  });

  describe('pickWinner', () => {
    it('higher total wins', () => {
      expect(pickWinner(s(4, 4, 4, 4), s(5, 5, 5, 5))).toBe('B');
      expect(pickWinner(s(5, 5, 5, 4), s(4, 4, 4, 4))).toBe('A');
    });
    it('tie goes to A (deterministic)', () => {
      expect(pickWinner(s(4, 4, 4, 4), s(4, 4, 4, 4))).toBe('A');
    });
    it('missing B scores -> A (degraded pair)', () => {
      expect(pickWinner(s(1, 1, 1, 1), null)).toBe('A');
    });
    it('missing A scores -> B', () => {
      expect(pickWinner(null, s(1, 1, 1, 1))).toBe('B');
    });
  });

  describe('parseJudgeJson', () => {
    it('parses fenced JSON and clamps to the rubric shape', () => {
      const parsed = parseJudgeJson('```json\n{"a":{"motion_quality":4,"artifacts":3,"realism":5,"composition":4},"b":{"motion_quality":2,"artifacts":2,"realism":2,"composition":2}}\n```');
      expect(parsed.a?.motion_quality).toBe(4);
      expect(parsed.b?.composition).toBe(2);
    });
    it('throws on non-JSON', () => {
      expect(() => parseJudgeJson('the better clip is A')).toThrow(/non-JSON/);
    });
  });
  ```
- [ ] Run `npx vitest run lib/delivery/judge.test.ts` — FAIL. Create `lib/delivery/judge.ts` (Gemini conventions follow `lib/providers/gemini-judge.ts`: `@google/genai`, `GEMINI_API_KEY ?? GOOGLE_API_KEY`, `responseMimeType: 'application/json'`, temperature 0.1, fence-stripping, `geminiCostCents` for cost, cost_event on failure too):
  ```ts
  import { GoogleGenAI } from '@google/genai';
  import { getSupabase } from '../client.js';
  import { recordCostEvent, log } from '../db.js';
  import { geminiCostCents } from '../providers/gemini-judge.js';
  import { getRun, getVariantsForRun, advanceRun, updateRun } from './runs.js';
  import { variantPairStatus } from './variants.js';
  import { orderScenesForAssembly } from '../assembly/scene-ordering.js';
  import type { SceneVariantRow } from '../types/operator-studio.js';
  import type { RoomType } from '../types.js';

  const AB_JUDGE_MODEL_DEFAULT = 'gemini-2.5-flash';

  export interface VariantScores {
    motion_quality: number;
    artifacts: number;
    realism: number;
    composition: number;
  }

  export function scoreTotal(s: VariantScores): number {
    return s.motion_quality + s.artifacts + s.realism + s.composition;
  }

  /** Deterministic winner: higher total; tie -> A; missing side loses. */
  export function pickWinner(a: VariantScores | null, b: VariantScores | null): 'A' | 'B' {
    if (!b) return 'A';
    if (!a) return 'B';
    return scoreTotal(b) > scoreTotal(a) ? 'B' : 'A';
  }

  export function parseJudgeJson(raw: string): { a: VariantScores | null; b: VariantScores | null } {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`A/B judge returned non-JSON: ${raw.slice(0, 200)}`);
    }
    const p = parsed as { a?: VariantScores; b?: VariantScores };
    return { a: p.a ?? null, b: p.b ?? null };
  }

  const AB_SYSTEM_PROMPT = `You compare two AI-generated real-estate video clips (A then B) rendered from the same source photo and prompt.
  Score EACH clip 1-5 on: motion_quality (smooth, intentional camera motion), artifacts (5 = none), realism (faithful to the photographed space, no invented geometry), composition.
  Return ONLY JSON: {"a":{"motion_quality":n,"artifacts":n,"realism":n,"composition":n},"b":{...}}`;

  async function judgePair(clipA: string, clipB: string, prompt: string, runId: string, sceneId: string, propertyId: string) {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY required for A/B judge');
    const model = process.env.AB_JUDGE_MODEL ?? AB_JUDGE_MODEL_DEFAULT;
    const genai = new GoogleGenAI({ apiKey });
    try {
      const resp = await genai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { text: `Director prompt: ${prompt}\nClip A is the first video, clip B the second. Score both.` },
            { fileData: { fileUri: clipA, mimeType: 'video/mp4' } },
            { fileData: { fileUri: clipB, mimeType: 'video/mp4' } },
          ],
        }],
        config: { systemInstruction: AB_SYSTEM_PROMPT, responseMimeType: 'application/json', temperature: 0.1 },
      });
      const rawText = resp.text ?? '';
      const scores = parseJudgeJson(rawText);
      const usage = (resp as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      const costCents = geminiCostCents(model, usage?.promptTokenCount ?? 0, usage?.candidatesTokenCount ?? 0);
      await recordCostEvent({
        propertyId, sceneId, stage: 'qc', provider: 'google',
        unitsConsumed: 1, unitType: 'tokens', costCents,
        metadata: { delivery_run_id: runId, scene_id: sceneId, subtype: 'ab_judge', judge_model: model,
          prompt_tokens: usage?.promptTokenCount ?? 0, output_tokens: usage?.candidatesTokenCount ?? 0 },
      }).catch((e) => console.error('[delivery/judge] cost_event failed:', e));
      return scores;
    } catch (err) {
      await recordCostEvent({
        propertyId, sceneId, stage: 'qc', provider: 'google',
        unitsConsumed: 1, unitType: 'tokens', costCents: 0,
        metadata: { delivery_run_id: runId, scene_id: sceneId, subtype: 'ab_judge', judge_error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
      throw err;
    }
  }

  /**
   * Judge pass — invoked by the poll-scenes cron once a delivery property's
   * scenes settle. Returns {ready:false} while B variants are still in flight
   * (next tick retries). On completion: winners set (winner_source='gemini'),
   * draft order stored on the run, stage -> checkpoint_a.
   */
  export async function runJudgePass(runId: string): Promise<{ ready: boolean }> {
    const supabase = getSupabase();
    const run = await getRun(runId);
    if (!run) throw new Error(`runJudgePass: run not found: ${runId}`);
    if (run.stage !== 'generating' && run.stage !== 'judging') return { ready: true }; // already past

    const variants = await getVariantsForRun(runId);
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id, scene_number, photo_id, prompt, clip_url, generation_cost_cents, status')
      .eq('property_id', run.property_id);

    // Sync A rows from the scenes table (the scene IS variant A).
    for (const scene of scenes ?? []) {
      const a = variants.find((v) => v.scene_id === scene.id && v.variant === 'A');
      if (a && !a.clip_url && scene.clip_url) {
        await supabase.from('scene_variants')
          .update({ clip_url: scene.clip_url, cost_cents: scene.generation_cost_cents ?? null, updated_at: new Date().toISOString() })
          .eq('id', a.id);
        a.clip_url = scene.clip_url as string;
      }
    }

    // All pairs must be settled (ready/degraded/failed — not pending).
    const judgeable = (scenes ?? []).filter((s) => variants.some((v) => v.scene_id === s.id));
    const pairs = judgeable.map((s) => ({
      scene: s,
      a: variants.find((v) => v.scene_id === s.id && v.variant === 'A') ?? null,
      b: variants.find((v) => v.scene_id === s.id && v.variant === 'B') ?? null,
    }));
    if (pairs.some((p) => variantPairStatus(p.a, p.b) === 'pending')) return { ready: false };

    if (run.stage === 'generating') await advanceRun(runId, 'judging');

    for (const { scene, a, b } of pairs) {
      const status = variantPairStatus(a, b);
      if (status === 'failed') continue; // operator regenerates at checkpoint A
      let winner: 'A' | 'B';
      if (status === 'degraded') {
        winner = a?.clip_url ? 'A' : 'B';
      } else {
        try {
          const scores = await judgePair(a!.clip_url!, b!.clip_url!, String(scene.prompt ?? ''), runId, scene.id as string, run.property_id);
          await supabase.from('scene_variants').update({ gemini_scores: scores.a, updated_at: new Date().toISOString() }).eq('id', a!.id);
          await supabase.from('scene_variants').update({ gemini_scores: scores.b, updated_at: new Date().toISOString() }).eq('id', b!.id);
          winner = pickWinner(scores.a, scores.b);
        } catch (err) {
          // Judge failure degrades gracefully: A wins by default, error logged.
          await log(run.property_id, 'qc', 'warn',
            `A/B judge failed for scene ${scene.scene_number}; defaulting winner=A: ${err instanceof Error ? err.message : String(err)}`,
            { delivery_run_id: runId }, scene.id as string);
          winner = 'A';
        }
      }
      const winnerRow = winner === 'A' ? a : b;
      const loserRow = winner === 'A' ? b : a;
      if (winnerRow) {
        await supabase.from('scene_variants')
          .update({ winner: true, winner_source: 'gemini', updated_at: new Date().toISOString() })
          .eq('id', winnerRow.id);
      }
      if (loserRow) {
        await supabase.from('scene_variants')
          .update({ winner: false, updated_at: new Date().toISOString() })
          .eq('id', loserRow.id);
      }
    }

    // Draft order (Task 12's helper) + advance.
    const { draftOrderForRun } = await import('./order.js');
    const order = await draftOrderForRun(runId);
    await updateRun(runId, { scene_order: order } as never);
    await advanceRun(runId, 'checkpoint_a');
    await log(run.property_id, 'qc', 'info', `A/B judging complete; ${order.length} winners ordered; checkpoint A ready`, { delivery_run_id: runId });
    return { ready: true };
  }
  ```
  (Task 12 creates `lib/delivery/order.ts`; until then the dynamic import would fail at runtime — Tasks 11+12 must both land before a live judge pass runs; tests for Task 11 are pure and don't execute `runJudgePass`.)
- [ ] `npx vitest run lib/delivery/judge.test.ts` — 7 passing.
- [ ] Gate the cron finalize: in `api/cron/poll-scenes.ts`, inside `for (const propertyId of affectedProperties)`, AFTER the `processingTimeMs` computation (line 374) and BEFORE the `if (finalStatus === 'complete')` branch (line 376) — `processingTimeMs` and `scenes` must already be in scope — insert:
  ```ts
  // Operator delivery: a property with a delivery run never auto-assembles.
  // Judge the A/B pairs instead; the operator drives the rest via checkpoints.
  const { data: deliveryRun } = await supabase
    .from('delivery_runs').select('id, stage').eq('property_id', propertyId).maybeSingle();
  if (deliveryRun) {
    try {
      const { runJudgePass } = await import('../../lib/delivery/judge.js');
      const { ready } = await runJudgePass(deliveryRun.id as string);
      if (ready) {
        await updatePropertyStatus(propertyId, 'needs_review', {
          processing_time_ms: processingTimeMs,
          thumbnail_url: scenes.find(s => s.clip_url)?.clip_url ?? null,
        });
      }
    } catch (err) {
      console.error('[poll-scenes] delivery judge pass failed:', err);
    }
    continue; // never falls through to runAssembly
  }
  ```
- [ ] Run `npx vitest run api/cron/__tests__` — existing cron tests still pass (the gate is additive; if a test stubs supabase narrowly, extend its mock so `from('delivery_runs')…maybeSingle()` resolves `{ data: null }`). Run `npm test` — baseline + new.
- [ ] Commit:
  ```bash
  git add lib/delivery/judge.ts lib/delivery/judge.test.ts api/cron/poll-scenes.ts
  git commit -m "feat(delivery): Gemini A/B judge pass + cron gate replacing auto-assembly for delivery runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 12: Draft order through `orderScenesForAssembly`

**Files:**
- Create: `lib/delivery/order.ts`, `lib/delivery/order.test.ts`

**Steps:**

- [ ] Write the failing test `lib/delivery/order.test.ts` (pure helper, mirrors the room-type hydration in `runAssemblyStep` lines 1243–1264):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { draftOrderFromWinners } from './order';

  it('orders winner scenes by the walkthrough policy (aerial first, exterior_back last)', () => {
    const order = draftOrderFromWinners([
      { id: 's-bed', scene_number: 2, room_type: 'bedroom' },
      { id: 's-aerial', scene_number: 5, room_type: 'aerial' },
      { id: 's-kitchen', scene_number: 1, room_type: 'kitchen' },
      { id: 's-back', scene_number: 3, room_type: 'exterior_back' },
    ]);
    expect(order).toEqual(['s-aerial', 's-kitchen', 's-bed', 's-back']);
  });

  it('keeps director order within a room bucket and tolerates null room types', () => {
    const order = draftOrderFromWinners([
      { id: 'b', scene_number: 2, room_type: null },
      { id: 'a', scene_number: 1, room_type: null },
    ]);
    expect(order).toEqual(['a', 'b']);
  });
  ```
- [ ] Run `npx vitest run lib/delivery/order.test.ts` — FAIL. Create `lib/delivery/order.ts`:
  ```ts
  import { getSupabase } from '../client.js';
  import { orderScenesForAssembly } from '../assembly/scene-ordering.js';
  import { getRun, getVariantsForRun } from './runs.js';
  import type { RoomType } from '../types.js';

  /** Pure: winner scenes -> ordered scene-id array via the walkthrough policy. */
  export function draftOrderFromWinners(
    scenes: Array<{ id: string; scene_number: number; room_type: RoomType | null }>,
  ): string[] {
    return orderScenesForAssembly(scenes).map((s) => s.id as string);
  }

  /** DB wrapper: load the run's winner scenes (room types via photos) and order them. */
  export async function draftOrderForRun(runId: string): Promise<string[]> {
    const supabase = getSupabase();
    const run = await getRun(runId);
    if (!run) throw new Error(`draftOrderForRun: run not found: ${runId}`);
    const variants = await getVariantsForRun(runId);
    const winnerSceneIds = Array.from(new Set(variants.filter((v) => v.winner && v.clip_url).map((v) => v.scene_id)));
    if (winnerSceneIds.length === 0) return [];

    const { data: scenes } = await supabase
      .from('scenes').select('id, scene_number, photo_id').in('id', winnerSceneIds);
    const photoIds = Array.from(new Set((scenes ?? []).map((s) => s.photo_id)));
    const { data: photos } = await supabase.from('photos').select('id, room_type').in('id', photoIds);
    const roomByPhoto = new Map<string, RoomType | null>(
      (photos ?? []).map((p) => [p.id as string, (p.room_type as RoomType | null) ?? null]),
    );
    return draftOrderFromWinners(
      (scenes ?? []).map((s) => ({
        id: s.id as string,
        scene_number: s.scene_number as number,
        room_type: roomByPhoto.get(s.photo_id as string) ?? null,
      })),
    );
  }
  ```
- [ ] `npx vitest run lib/delivery/order.test.ts` — 2 passing. `npx vitest run lib/delivery` — all delivery tests green.
- [ ] Commit:
  ```bash
  git add lib/delivery/order.ts lib/delivery/order.test.ts
  git commit -m "feat(delivery): draft clip order from winners via orderScenesForAssembly

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 13: Stepper shell UI in Property Command Center

**Files:**
- Create: `src/components/studio/DeliveryStepper.tsx`
- Modify: `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (Bundle interface ~line 52–58; render the stepper + a `DeliverySection` slot under the StatusPill header)

**Steps:**

- [ ] Create `src/components/studio/DeliveryStepper.tsx`:
  ```tsx
  import { DELIVERY_STAGES, type DeliveryStage, stageIndex } from '../../../lib/delivery/state';

  const STAGE_LABELS: Record<DeliveryStage, string> = {
    intake: 'Intake', scraping: 'Scrape', generating: 'Generate', judging: 'Judge',
    checkpoint_a: 'Checkpoint A', details: 'Details', voiceover: 'Voiceover',
    music: 'Music', assembling: 'Assemble', checkpoint_b: 'Checkpoint B', delivered: 'Delivered',
  };

  export function DeliveryStepper({ stage, error }: { stage: DeliveryStage; error: string | null }) {
    const current = stageIndex(stage);
    return (
      <div className="studio-card" style={{ padding: '16px 20px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 720 }}>
          {DELIVERY_STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < DELIVERY_STAGES.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 600,
                    background: done ? 'var(--le-ink)' : active ? 'var(--le-surface)' : 'transparent',
                    color: done ? 'var(--le-surface)' : active ? 'var(--le-ink)' : 'var(--le-muted-2)',
                    border: `1.5px solid ${done || active ? 'var(--le-ink)' : 'var(--le-line)'}`,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', color: active ? 'var(--le-ink)' : 'var(--le-muted)' }}>
                    {STAGE_LABELS[s]}
                  </span>
                </div>
                {i < DELIVERY_STAGES.length - 1 && (
                  <div style={{ flex: 1, height: 1.5, margin: '0 6px 16px', background: done ? 'var(--le-ink)' : 'var(--le-line)' }} />
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--le-bad, #b42318)' }}>
            Stage error: {error} — fix below and retry.
          </p>
        )}
      </div>
    );
  }
  ```
- [ ] In `PropertyCommandCenter.tsx`:
  - Add `delivery_run: { id: string; stage: string; error: string | null; listing_details: Record<string, unknown>; scene_order: string[] | null; voiceover_script: string | null; voiceover_voice_id: string | null; voiceover_audio_url: string | null; music_track_id: string | null; video_type: string } | null;` to the `Bundle` interface.
  - Import `DeliveryStepper` and `isDeliveryStage` (from `../../../../lib/delivery/state`).
  - Render directly below the page heading, only in operator mode: `{bundle.delivery_run && isDeliveryStage(bundle.delivery_run.stage) && (<DeliveryStepper stage={bundle.delivery_run.stage} error={bundle.delivery_run.error} />)}`.
  - Add a generic advance helper used by all checkpoint sections in later tasks:
    ```tsx
    const deliveryAction = useCallback(async (body: Record<string, unknown>) => {
      if (!bundle?.delivery_run) return;
      const res = await authedFetch(`/api/admin/studio/delivery/${bundle.delivery_run.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `${res.status}`);
      }
      await loadBundle(); // existing refetch function in this page
    }, [bundle, loadBundle]);
    ```
    (Use whatever the page's existing refetch callback is named — it loads `/api/admin/studio/properties/${id}` around line 214; reuse it.)
  - Render a "Next" gated button only on checkpoint/details/voiceover/music stages (each later task adds its section; this task adds the shared `<DeliveryNextButton>` that calls `deliveryAction({ action: 'advance', to: nextStage(stage) })` and disables while pending).
- [ ] `npx vite build` — exit 0. Verify on a property WITHOUT a delivery run (legacy/customer): page renders unchanged, no stepper. With a run: 11-step stepper shows with the current stage highlighted.
- [ ] Commit:
  ```bash
  git add src/components/studio/DeliveryStepper.tsx src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(studio): delivery stepper shell in Property Command Center (operator-mode only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 14: Checkpoint A — reorder (drag via existing react-dnd) + persistence + ml_event

`react-dnd@16` + `react-dnd-html5-backend@16` are already in package.json — no new dependency. Also render up/down arrow buttons as a keyboard/touch fallback.

**Files:**
- Create: `src/components/studio/CheckpointA.tsx`
- Modify: `api/admin/studio/delivery/[runId].ts` (add `reorder` action), `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (render `<CheckpointA>` when stage `'checkpoint_a'`)
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Extend the route test with a failing case: POST `{action:'reorder', scene_order:['s2','s1']}` on a run whose `scene_order` is `['s1','s2']` → 200, `updateRun` called with the new order, `recordMlEvent('r1','reorder', { before:['s1','s2'], after:['s2','s1'] })`; POST reorder with a different id SET (`['s1','s3']`) → 400. Run it — FAIL.
- [ ] Add to the `[runId].ts` switch:
  ```ts
  case 'reorder': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const after = (req.body?.scene_order ?? []) as string[];
    const before = (run.scene_order ?? []) as string[];
    if ([...after].sort().join(',') !== [...before].sort().join(',')) {
      return res.status(400).json({ error: 'scene_order must be a permutation of the current order' });
    }
    const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const updated = await updateRun(runId, { scene_order: after } as never);
    await recordMlEvent(runId, 'reorder', { before, after });
    return res.status(200).json({ run: updated });
  }
  ```
  Run the route test — passing.
- [ ] Create `src/components/studio/CheckpointA.tsx`: fetches `GET /api/admin/studio/delivery/{runId}` (run + variants) via `authedFetch`; renders the winner clip of each scene in `scene_order` order as a horizontal card row (`<video src={clip_url} muted loop playsInline>` thumbnails, like `SceneStrip`). Wrap the row in `DndProvider` (`react-dnd` + `HTML5Backend`); each card is both `useDrag` (type `'delivery-clip'`, item `{ id }`) and `useDrop` (on hover-swap reorder local state). Also render ▲/▼ buttons per card mutating local order. A "Save order" button (enabled when local order ≠ saved order) POSTs `{ action: 'reorder', scene_order: localOrder }` and refetches. Variant badges: show `A`/`B` + "Gemini pick" / "Operator pick" from `winner_source`, and a degraded chip when the pair's loser row has `degraded=true`.
- [ ] Wire into `PropertyCommandCenter.tsx`: `{bundle.delivery_run?.stage === 'checkpoint_a' && <CheckpointA runId={bundle.delivery_run.id} onChanged={loadBundle} />}` plus the shared Next button (`advance` to `'details'`).
- [ ] `npx vite build` — exit 0. Manual check: drag + arrows both reorder; Save persists; reload preserves order.
- [ ] Commit:
  ```bash
  git add src/components/studio/CheckpointA.tsx "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): checkpoint A clip reorder (react-dnd + arrows) with reorder ml_event

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 15: Checkpoint A — regenerate a scene + flip A↔B

**Files:**
- Modify: `lib/delivery/variants.ts` (add `regenerateVariant`), `api/admin/studio/delivery/[runId].ts` (`regenerate` + `flip_winner` actions), `src/components/studio/CheckpointA.tsx` (per-card buttons)
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Extend the route test (failing first): POST `{action:'flip_winner', scene_id:'s1'}` → 200 and `recordMlEvent('r1','variant_override', expect.objectContaining({ scene_id: 's1' }))`; POST `{action:'regenerate', scene_id:'s1', variant:'B'}` → 200 and `recordMlEvent('r1','regenerate', expect.objectContaining({ scene_id: 's1', variant: 'B' }))` (mock a new `regenerateVariant` in the `lib/delivery/variants` mock). Run — FAIL.
- [ ] Add `regenerateVariant` to `lib/delivery/variants.ts` — same provider-submit body as the B-submit in `submitVariantsForProperty`, but resets ONE existing variant row:
  ```ts
  /** Re-render one variant: reset its row and submit a fresh provider run. */
  export async function regenerateVariant(runId: string, sceneId: string, variant: 'A' | 'B'): Promise<void> {
    const supabase = getSupabase();
    const { data: scene } = await supabase
      .from('scenes')
      .select('id, property_id, scene_number, photo_id, prompt, duration_seconds, camera_movement, provider, end_photo_id, end_image_url')
      .eq('id', sceneId).single();
    if (!scene) throw new Error('regenerateVariant: scene not found');
    const { data: photo } = await supabase.from('photos').select('file_url, room_type').eq('id', scene.photo_id).single();
    if (!photo) throw new Error('regenerateVariant: source photo not found');
    const { data: prop } = await supabase.from('properties').select('pipeline_mode').eq('id', scene.property_id).maybeSingle();

    const decision = selectProviderForScene(
      {
        endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
        movement: (scene.camera_movement as CameraMovement | null) ?? null,
        roomType: ((photo as { room_type?: string }).room_type as RoomType) ?? 'other',
        preference: (scene.provider as VideoProvider | null) ?? null,
      },
      [],
      ((prop?.pipeline_mode as PipelineMode | null) ?? 'v1'),
    );
    const provider = buildProviderFromDecision(decision);
    const genJob = await provider.generateClip({
      sourceImage: Buffer.alloc(0),
      sourceImageUrl: (photo as { file_url: string }).file_url,
      prompt: scene.prompt as string,
      durationSeconds: scene.duration_seconds,
      aspectRatio: '16:9',
      endImageUrl: (scene as { end_image_url?: string | null }).end_image_url ?? undefined,
      modelOverride: decision.modelKey,
    });
    await supabase.from('scene_variants').upsert({
      delivery_run_id: runId, scene_id: sceneId, variant,
      provider: provider.name, provider_task_id: genJob.jobId,
      clip_url: null, cost_cents: null, gemini_scores: null,
      winner: false, winner_source: null, degraded: false, error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'scene_id,variant' });
  }
  ```
  Generalize `pollPendingVariants` to poll BOTH variants whose `clip_url` is null with a task id (drop the `.eq('variant','B')` filter, but skip 'A' rows whose scene still owns the task — i.e. only poll an 'A' row when its `provider_task_id` differs from the scene's `provider_task_id`; pass the scene's task id into the row comparison).
- [ ] Add the route actions:
  ```ts
  case 'flip_winner': {
    const sceneId = String(req.body?.scene_id ?? '');
    if (!sceneId) return res.status(400).json({ error: 'scene_id required' });
    const { getVariantsForRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const variants = (await getVariantsForRun(runId)).filter((v) => v.scene_id === sceneId);
    const a = variants.find((v) => v.variant === 'A');
    const b = variants.find((v) => v.variant === 'B');
    if (!a?.clip_url || !b?.clip_url) return res.status(400).json({ error: 'both variants need clips to flip' });
    const oldWinner = a.winner ? 'A' : 'B';
    const newWinner = oldWinner === 'A' ? 'B' : 'A';
    const db = (await import('../../../../lib/client.js')).getSupabase();
    await db.from('scene_variants').update({ winner: newWinner === 'A', winner_source: 'operator', updated_at: new Date().toISOString() }).eq('id', a.id);
    await db.from('scene_variants').update({ winner: newWinner === 'B', winner_source: 'operator', updated_at: new Date().toISOString() }).eq('id', b.id);
    await recordMlEvent(runId, 'variant_override', { scene_id: sceneId, from: oldWinner, to: newWinner });
    return res.status(200).json({ ok: true });
  }
  case 'regenerate': {
    const sceneId = String(req.body?.scene_id ?? '');
    const variant = req.body?.variant === 'A' ? 'A' : 'B';
    if (!sceneId) return res.status(400).json({ error: 'scene_id required' });
    const { regenerateVariant } = await import('../../../../lib/delivery/variants.js');
    const { recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    await regenerateVariant(runId, sceneId, variant);
    await recordMlEvent(runId, 'regenerate', { scene_id: sceneId, variant });
    return res.status(200).json({ ok: true });
  }
  ```
- [ ] Run `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts lib/delivery/variants.test.ts` — all pass.
- [ ] `CheckpointA.tsx`: per-card "Flip A↔B" button (POST `flip_winner`), "Regenerate" dropdown (A or B → POST `regenerate`, card shows a "rendering…" spinner until the variant poll lands a new clip — poll the GET endpoint every 10s while any variant is in flight).
- [ ] `npx vite build` — exit 0. Commit:
  ```bash
  git add lib/delivery/variants.ts "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts src/components/studio/CheckpointA.tsx
  git commit -m "feat(delivery): checkpoint A regenerate + variant flip with ml_events

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 16: Details step UI

**Files:**
- Create: `src/components/studio/DeliveryDetails.tsx`
- Modify: `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (render when stage `'details'`)

**Steps:**

- [ ] Create `src/components/studio/DeliveryDetails.tsx`: a `SectionCard`-style block with inputs prefilled from `delivery_run.listing_details` — Price, Beds, Baths, Sqft (number inputs, `.studio-input studio-tabnum`) and MLS description (`.studio-textarea`, rows 5). When `listing_details.price == null && listing_details.beds == null` (scrape missed), show an amber banner: `<span style={{ color: 'var(--le-warn, #b54708)' }}>Scrape missed — enter listing details manually.</span>`. "Save details" PATCHes `/api/admin/studio/delivery/{runId}` with the numeric-coerced fields (the server stamps `source:'manual'` + logs `details_edit`). The shared Next button advances `'details' → 'voiceover'`.
- [ ] Wire into `PropertyCommandCenter.tsx` for stage `'details'`.
- [ ] `npx vite build` — exit 0. Manual: scraped values prefill; editing + Save round-trips; amber state shows on an empty-details run.
- [ ] Commit:
  ```bash
  git add src/components/studio/DeliveryDetails.tsx src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): details step UI with scrape-miss manual entry state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 17: Voiceover script generation (Sonnet 4.6)

**Files:**
- Create: `lib/delivery/voiceover-script.ts`, `lib/delivery/voiceover-script.test.ts`
- Modify: `api/admin/studio/delivery/[runId].ts` (`generate_script` + `set_script` actions)
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Write the failing test `lib/delivery/voiceover-script.test.ts` for the pure prompt builder:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildScriptUserMessage } from './voiceover-script';

  it('includes address, video type label, duration, details, and MLS description', () => {
    const msg = buildScriptUserMessage({
      address: '470 Sorrento Ct, Punta Gorda, FL',
      videoType: 'just_pended',
      durationSec: 30,
      details: { price: 899000, beds: 3, baths: 2, sqft: 1823, mls_description: 'Waterfront pool home.' },
    });
    expect(msg).toContain('470 Sorrento Ct');
    expect(msg).toContain('Just Pended');
    expect(msg).toContain('30 seconds');
    expect(msg).toContain('$899,000');
    expect(msg).toContain('3 bed');
    expect(msg).toContain('Waterfront pool home.');
  });

  it('omits missing details gracefully', () => {
    const msg = buildScriptUserMessage({ address: 'X St', videoType: 'just_listed', durationSec: 15, details: {} });
    expect(msg).not.toContain('$');
    expect(msg).toContain('Just Listed');
  });
  ```
- [ ] Run `npx vitest run lib/delivery/voiceover-script.test.ts` — FAIL. Create `lib/delivery/voiceover-script.ts` (conventions from `lib/voiceover/generate-script.ts`: `claude-sonnet-4-6`, `computeClaudeCost`, word budget from `WORD_BUDGET`, audio tags allowed since TTS target is `eleven_v3`):
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  import { computeClaudeCost } from '../utils/claude-cost.js';
  import { recordCostEvent } from '../db.js';
  import { WORD_BUDGET } from '../voiceover/voices.js';
  import { countWords, trimToWordBudget } from '../voiceover/generate-script.js';
  import { stripAudioTags } from '../voiceover/audio-tags.js';
  import type { ListingDetails, DeliveryVideoType } from '../types/operator-studio.js';

  const MODEL = 'claude-sonnet-4-6';

  const VIDEO_TYPE_LABELS: Record<DeliveryVideoType, string> = {
    just_listed: 'Just Listed', just_pended: 'Just Pended', just_closed: 'Just Closed',
  };

  const SYSTEM_PROMPT = `You write welcoming real-estate listing-video voiceover scripts.
  STRICT word budget: {wordBudget} words maximum (spoken read ~150 wpm must fit the duration).
  Structure: warm greeting naming the property -> 3-5 distinctive features from the MLS description and facts -> one short closing line tied to the video type.
  Tone: warm, inviting, real-estate-classic. Output the script ONLY.
  DELIVERY CUES (ElevenLabs v3 audio tags): sprinkle 2-4 of ONLY these inline cues: [warmly], [calmly], [softly], [gently], [enthusiastically], [pause]. Tags do not count toward the word budget.`;

  export function buildScriptUserMessage(input: {
    address: string;
    videoType: DeliveryVideoType;
    durationSec: number;
    details: ListingDetails;
  }): string {
    const { address, videoType, durationSec, details } = input;
    const facts: string[] = [];
    if (details.price) facts.push(`Price: $${details.price.toLocaleString('en-US')}`);
    if (details.beds) facts.push(`${details.beds} bedrooms`);
    if (details.baths) facts.push(`${details.baths} bathrooms`);
    if (details.sqft) facts.push(`${details.sqft.toLocaleString('en-US')} sqft`);
    return [
      `Property: ${address}`,
      `Video type: ${VIDEO_TYPE_LABELS[videoType]}`,
      `Duration: ${durationSec} seconds`,
      facts.length ? `Facts: ${facts.join(' · ')}` : '',
      details.mls_description ? `MLS description:\n${details.mls_description}` : 'No MLS description available — write from the facts.',
      `\nWrite a ${durationSec} seconds voiceover script.`,
    ].filter(Boolean).join('\n');
  }
  ```
  (The test's `'3 bed'` assertion is satisfied by the `'3 bedrooms'` fact string.)
  ```ts
  export async function generateDeliveryScript(input: {
    runId: string;
    propertyId: string;
    address: string;
    videoType: DeliveryVideoType;
    durationSec: number;
    details: ListingDetails;
  }): Promise<{ script: string; wordCount: number }> {
    const wordBudget = WORD_BUDGET[input.durationSec] ?? 75;
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT.replace('{wordBudget}', String(wordBudget)),
      messages: [{ role: 'user', content: buildScriptUserMessage(input) }],
    });
    const rawText = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!rawText) throw new Error('Delivery script generation returned empty text');
    const spoken = countWords(stripAudioTags(rawText));
    const script = spoken > wordBudget ? trimToWordBudget(stripAudioTags(rawText), wordBudget) : rawText;

    const cost = computeClaudeCost(response.usage as never, MODEL);
    await recordCostEvent({
      propertyId: input.propertyId, stage: 'scripting', provider: 'anthropic',
      unitsConsumed: cost.totalTokens, unitType: 'tokens', costCents: cost.costCents,
      metadata: {
        delivery_run_id: input.runId, subtype: 'delivery_voiceover_script', model: MODEL,
        duration_sec: input.durationSec, word_budget: wordBudget,
        input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens,
      },
    }).catch((e) => console.error('[delivery/voiceover-script] cost_event failed:', e));

    return { script, wordCount: countWords(stripAudioTags(script)) };
  }
  ```
  (`countWords` / `trimToWordBudget` are already exported from `lib/voiceover/generate-script.ts` — verified.)
- [ ] `npx vitest run lib/delivery/voiceover-script.test.ts` — 2 passing.
- [ ] Route actions (extend test first: `generate_script` calls the generator + stores via `updateRun`; `set_script` records `script_edit` with before/after):
  ```ts
  case 'generate_script': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const db = (await import('../../../../lib/client.js')).getSupabase();
    const { data: prop } = await db.from('properties').select('address').eq('id', run.property_id).maybeSingle();
    const { generateDeliveryScript } = await import('../../../../lib/delivery/voiceover-script.js');
    const { updateRun } = await import('../../../../lib/delivery/runs.js');
    const { script } = await generateDeliveryScript({
      runId, propertyId: run.property_id, address: String(prop?.address ?? ''),
      videoType: run.video_type, durationSec: run.duration_seconds ?? 30, details: run.listing_details ?? {},
    });
    const updated = await updateRun(runId, { voiceover_script: script } as never);
    return res.status(200).json({ run: updated });
  }
  case 'set_script': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const script = String(req.body?.script ?? '').trim();
    if (!script) return res.status(400).json({ error: 'script required' });
    const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const updated = await updateRun(runId, { voiceover_script: script } as never);
    if (run.voiceover_script && run.voiceover_script !== script) {
      await recordMlEvent(runId, 'script_edit', { before: run.voiceover_script, after: script });
    }
    return res.status(200).json({ run: updated });
  }
  ```
- [ ] `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts` — all pass.
- [ ] Commit:
  ```bash
  git add lib/delivery/voiceover-script.ts lib/delivery/voiceover-script.test.ts "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts
  git commit -m "feat(delivery): Sonnet 4.6 voiceover script generation from MLS details + video type

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 18: Voiceover UI — editable script, voice picker, audio generation

The ElevenLabs V3 roster already exists as a const: `VOICES` in `lib/voiceover/voices.ts` (Mark/Jack/Amanda/Jessica, verified 2026-05) — no new hardcoding, no live voices API call needed.

**Files:**
- Create: `api/admin/studio/voices.ts` (flat — no rewrite needed), `src/components/studio/DeliveryVoiceover.tsx`
- Modify: `api/admin/studio/delivery/[runId].ts` (`set_voice` + `generate_audio` actions), `src/pages/dashboard/studio/PropertyCommandCenter.tsx`
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Create `api/admin/studio/voices.ts`:
  ```ts
  import type { VercelRequest, VercelResponse } from '@vercel/node';
  import { requireAdmin } from '../../../lib/auth.js';
  import { VOICES } from '../../../lib/voiceover/voices.js';
  import { getSupabase } from '../../../lib/client.js';

  export default async function handler(req: VercelRequest, res: VercelResponse) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;
    let clientVoiceId: string | null = null;
    if (clientId) {
      const { data } = await getSupabase().from('clients').select('voice_id').eq('id', clientId).maybeSingle();
      clientVoiceId = (data as { voice_id?: string | null } | null)?.voice_id ?? null;
    }
    return res.status(200).json({ voices: VOICES, client_voice_id: clientVoiceId });
  }
  ```
- [ ] Route actions in `[runId].ts` (test first — `set_voice` records `voice_choice` with `{voice_id, is_client_voice}`; `generate_audio` requires a script + voice):
  ```ts
  case 'set_voice': {
    const voiceId = String(req.body?.voice_id ?? '');
    if (!voiceId) return res.status(400).json({ error: 'voice_id required' });
    const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const updated = await updateRun(runId, { voiceover_voice_id: voiceId } as never);
    await recordMlEvent(runId, 'voice_choice', { voice_id: voiceId, is_client_voice: Boolean(req.body?.is_client_voice) });
    return res.status(200).json({ run: updated });
  }
  case 'generate_audio': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    if (!run.voiceover_script) return res.status(400).json({ error: 'generate the script first' });
    if (!run.voiceover_voice_id) return res.status(400).json({ error: 'pick a voice first' });
    const { generateVoiceoverAudio } = await import('../../../../lib/voiceover/generate-audio.js');
    const { updateRun, setRunError } = await import('../../../../lib/delivery/runs.js');
    try {
      // Retry-once policy (spec error handling): one immediate retry, then flag.
      let audioUrl: string;
      try {
        ({ audioUrl } = await generateVoiceoverAudio({
          script: run.voiceover_script, voiceId: run.voiceover_voice_id,
          propertyId: run.property_id, storageFolder: run.property_id,
        }));
      } catch {
        ({ audioUrl } = await generateVoiceoverAudio({
          script: run.voiceover_script, voiceId: run.voiceover_voice_id,
          propertyId: run.property_id, storageFolder: run.property_id,
        }));
      }
      const updated = await updateRun(runId, { voiceover_audio_url: audioUrl } as never);
      return res.status(200).json({ run: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setRunError(runId, `Voiceover audio failed twice: ${msg} — you can skip (assembly proceeds without VO).`);
      return res.status(502).json({ error: msg });
    }
  }
  ```
  (`generateVoiceoverAudio` records its own elevenlabs cost_event per call — both attempts get tracked.)
- [ ] `npx vitest run api/admin/studio/delivery/__tests__/runId.test.ts` — all pass.
- [ ] Create `src/components/studio/DeliveryVoiceover.tsx`: "Generate script" button (POST `generate_script`, spinner) → editable `.studio-textarea` bound to local state; on blur or "Save script", POST `set_script` (server logs `script_edit` with before/after). Voice picker: radio cards from `GET /api/admin/studio/voices?client_id={property.client_id}` — each `VOICES` entry shows name/gender/description; when `client_voice_id` is set, prepend a card labeled with a "Client voice" badge (`.studio-status-pill`-style). Selecting POSTs `set_voice` (`is_client_voice: voice_id === client_voice_id`). "Generate audio" POSTs `generate_audio`; on success render `<audio controls src={voiceover_audio_url} />`. Next button advances `'voiceover' → 'music'` (allowed even without audio — skip-with-flag policy).
- [ ] Wire into `PropertyCommandCenter.tsx` for stage `'voiceover'`. `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add api/admin/studio/voices.ts src/components/studio/DeliveryVoiceover.tsx "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): voiceover step — script editing, voice roster + client voice, audio generation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 19: Music — library-first options + generate-new

**Files:**
- Create: `api/admin/studio/music-options.ts` (flat), `src/components/studio/DeliveryMusic.tsx`
- Modify: `api/admin/studio/delivery/[runId].ts` (`set_music` + `generate_music` actions)
- Test: `api/admin/studio/__tests__/music-options.test.ts` (create), extend `runId.test.ts`

**Steps:**

- [ ] Write the failing test `api/admin/studio/__tests__/music-options.test.ts`: mock `requireAdmin` + `lib/client` supabase chain; GET `?video_type=just_closed` queries `music_tracks` with `mood_tag='celebratory'` (via `moodForPackage`) and returns up to 3 active tracks. Run — FAIL.
- [ ] Create `api/admin/studio/music-options.ts`:
  ```ts
  import type { VercelRequest, VercelResponse } from '@vercel/node';
  import { requireAdmin } from '../../../lib/auth.js';
  import { getSupabase } from '../../../lib/client.js';
  import { moodForPackage } from '../../../lib/assembly/music.js';

  export default async function handler(req: VercelRequest, res: VercelResponse) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const videoType = typeof req.query.video_type === 'string' ? req.query.video_type : null;
    const mood = moodForPackage(videoType);
    const { data, error } = await getSupabase()
      .from('music_tracks')
      .select('id, name, file_url, mood_tag, source')
      .eq('mood_tag', mood)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ mood, tracks: data ?? [] });
  }
  ```
  Run the test — passing.
- [ ] Route actions in `[runId].ts` (test first: `set_music` stores `music_track_id` + `music_choice` event with `{music_track_id, source:'library'|'generated'}`):
  ```ts
  case 'set_music': {
    const trackId = String(req.body?.music_track_id ?? '');
    if (!trackId) return res.status(400).json({ error: 'music_track_id required' });
    const { updateRun, recordMlEvent } = await import('../../../../lib/delivery/runs.js');
    const updated = await updateRun(runId, { music_track_id: trackId } as never);
    await recordMlEvent(runId, 'music_choice', { music_track_id: trackId, source: String(req.body?.source ?? 'library') });
    return res.status(200).json({ run: updated });
  }
  case 'generate_music': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const { moodForPackage } = await import('../../../../lib/assembly/music.js');
    const { composeMusic, MOOD_PROMPTS } = await import('../../../../lib/providers/elevenlabs-music.js');
    const mood = moodForPackage(run.video_type);
    const lengthMs = Math.max((run.duration_seconds ?? 30) * 1000, 15_000) + 5_000; // cover the video + tail
    const db = (await import('../../../../lib/client.js')).getSupabase();
    try {
      // composeMusic records the elevenlabs cost_event (stage 'assembly'); pass
      // propertyId so it attributes to this property's ledger.
      const { audio } = await composeMusic(MOOD_PROMPTS[mood], lengthMs, { propertyId: run.property_id });
      const path = `delivery/${run.id}/${Date.now()}.mp3`;
      const { error: upErr } = await db.storage.from('music').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = db.storage.from('music').getPublicUrl(path);
      const { data: track, error: insErr } = await db.from('music_tracks').insert({
        name: `Generated · ${mood} · ${new Date().toISOString().slice(0, 10)}`,
        file_url: urlData.publicUrl, mood_tag: mood, source: 'elevenlabs_music',
        prompt: MOOD_PROMPTS[mood], active: true,
      }).select('id, name, file_url, mood_tag, source').single();
      if (insErr) throw new Error(insErr.message);
      return res.status(201).json({ track });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { setRunError } = await import('../../../../lib/delivery/runs.js');
      await setRunError(runId, `Music generation failed: ${msg} — pick a library track or skip.`);
      return res.status(502).json({ error: msg });
    }
  }
  ```
  (`music` is the existing public storage bucket used by `scripts/generate-music-pool.ts`. The new track joins the library — spec requirement.)
- [ ] `npx vitest run api/admin/studio/__tests__/music-options.test.ts api/admin/studio/delivery/__tests__/runId.test.ts` — all pass.
- [ ] Create `src/components/studio/DeliveryMusic.tsx`: fetch `GET /api/admin/studio/music-options?video_type={run.video_type}`; render 3 radio cards (name + `<audio controls>` preview + mood chip); selecting POSTs `set_music` `{music_track_id, source:'library'}`. "Generate new" button POSTs `generate_music`, appends the returned track to the cards, auto-selects it via `set_music` `{source:'generated'}`. Next advances `'music' → 'assembling'` AND immediately POSTs `{action:'assemble'}` (Task 20).
- [ ] Wire into `PropertyCommandCenter.tsx` for stage `'music'`. `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add api/admin/studio/music-options.ts api/admin/studio/__tests__/music-options.test.ts src/components/studio/DeliveryMusic.tsx "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): music step — 3 library options by mood + ElevenLabs generate-new into library

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 20: Assembly — wire run state into the existing Creatomate path

Strategy: write run state back onto the property/scenes the existing `runAssemblyStep` already reads, then call `rerunAssembly()`. One surgical, gated edit inside `runAssemblyStep` honors the operator's clip order.

**Files:**
- Create: `lib/delivery/assemble.ts`, `lib/delivery/assemble.test.ts`
- Modify: `lib/pipeline.ts` (`runAssemblyStep`, after the `orderScenesForAssembly` call at line 1259–1264), `api/admin/studio/delivery/[runId].ts` (`assemble` action)

**Steps:**

- [ ] Write the failing test `lib/delivery/assemble.test.ts` for the pure order-applier that pipeline will use:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { applySceneOrder } from './assemble';

  it('reorders scenes to the run order, appending unknown scenes at the end', () => {
    const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Array<{ id: string }>;
    expect(applySceneOrder(scenes, ['c', 'a']).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });
  it('null/empty order is a no-op', () => {
    const scenes = [{ id: 'a' }, { id: 'b' }] as Array<{ id: string }>;
    expect(applySceneOrder(scenes, null).map((s) => s.id)).toEqual(['a', 'b']);
  });
  ```
- [ ] Run `npx vitest run lib/delivery/assemble.test.ts` — FAIL. Create `lib/delivery/assemble.ts`:
  ```ts
  import { getSupabase } from '../client.js';
  import { getRun, getVariantsForRun, advanceRun, setRunError } from './runs.js';

  /** Pure: reorder by an explicit id list; unknown ids keep relative order at the end. */
  export function applySceneOrder<T extends { id: string }>(scenes: T[], order: string[] | null): T[] {
    if (!order || order.length === 0) return scenes;
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...scenes].sort((a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }

  /**
   * Stage side effect for 'assembling': write the run's choices onto the rows
   * the existing assembly path reads, then reuse rerunAssembly() verbatim.
   *  - winner B clips -> scenes.clip_url (swap-clip precedent)
   *  - run.music_track_id -> properties.music_track_id (selectMusicTrackForProperty picks it up)
   *  - run.voiceover_audio_url -> properties.voiceover_url (+ script/voice) so
   *    ensureVoiceover's "already exists" branch reuses it
   *  - listing details -> properties.price/bedrooms/bathrooms (template overlays)
   * Then advances assembling -> checkpoint_b (rerunAssembly is synchronous —
   * it polls the Creatomate render to completion inside the call).
   */
  export async function runAssembleStage(runId: string): Promise<void> {
    const supabase = getSupabase();
    const run = await getRun(runId);
    if (!run) throw new Error(`runAssembleStage: run not found: ${runId}`);
    if (run.stage !== 'assembling') throw new Error(`runAssembleStage: run is in '${run.stage}', expected 'assembling'`);

    try {
      // 1. Winner clips: where B won, point the scene at the B clip.
      const variants = await getVariantsForRun(runId);
      for (const v of variants.filter((x) => x.winner && x.variant === 'B' && x.clip_url)) {
        await supabase.from('scenes').update({ clip_url: v.clip_url, status: 'qc_pass' }).eq('id', v.scene_id);
      }

      // 2. Property-level choices.
      const d = run.listing_details ?? {};
      await supabase.from('properties').update({
        music_track_id: run.music_track_id ?? null,
        ...(run.voiceover_audio_url ? {
          voiceover_url: run.voiceover_audio_url,
          voiceover_script: run.voiceover_script,
          voiceover_voice_id: run.voiceover_voice_id,
          add_voiceover: true,
        } : {}),
        ...(d.price != null ? { price: d.price } : {}),
        ...(d.beds != null ? { bedrooms: d.beds } : {}),
        ...(d.baths != null ? { bathrooms: d.baths } : {}),
      }).eq('id', run.property_id);

      // 3. Existing assembly path (records its own creatomate cost_events).
      const { rerunAssembly } = await import('../pipeline.js');
      await rerunAssembly(run.property_id);

      await advanceRun(runId, 'checkpoint_b');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setRunError(runId, `Assembly failed: ${msg}`);
      throw err;
    }
  }
  ```
- [ ] `npx vitest run lib/delivery/assemble.test.ts` — 2 passing.
- [ ] Surgical pipeline edit — in `lib/pipeline.ts runAssemblyStep`, immediately AFTER the `const passedScenes = orderScenesForAssembly(...)` block (line 1259–1264), insert the gated order override:
  ```ts
  // Operator delivery: honor the operator's checkpoint-A clip order when a
  // delivery run with an explicit scene_order exists. Customer flow (no run)
  // keeps the deterministic walkthrough order above, byte-identical.
  let orderedScenes = passedScenes;
  try {
    const { data: deliveryRun } = await getSupabase()
      .from('delivery_runs').select('scene_order').eq('property_id', propertyId).maybeSingle();
    const order = (deliveryRun?.scene_order as string[] | null) ?? null;
    if (order && order.length > 0) {
      const { applySceneOrder } = await import('./delivery/assemble.js');
      orderedScenes = applySceneOrder(passedScenes as Array<{ id: string }>, order) as typeof passedScenes;
      await log(propertyId, "assembly", "info", "Using operator delivery scene order", { order });
    }
  } catch { /* gated read — never fails customer assembly */ }
  ```
  then replace subsequent uses of `passedScenes` inside this function (`fitScenesToDuration(passedScenes.map(...))` at line 1304, `passedScenes[0]?.clip_url` at line 1617, the two log lines) with `orderedScenes`.
- [ ] `assemble` action in `[runId].ts`:
  ```ts
  case 'assemble': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    if (run.stage === 'music') await (await import('../../../../lib/delivery/runs.js')).advanceRun(runId, 'assembling');
    const { runAssembleStage } = await import('../../../../lib/delivery/assemble.js');
    await runAssembleStage(runId);
    const updated = await getRun(runId);
    return res.status(200).json({ run: updated });
  }
  ```
- [ ] Run `npm test` — full suite green vs baseline (especially `lib/__tests__/rerun-assembly.test.ts` — if its supabase mock doesn't cover `from('delivery_runs')`, extend the mock to resolve `{ data: null }`). `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add lib/delivery/assemble.ts lib/delivery/assemble.test.ts lib/pipeline.ts "api/admin/studio/delivery/[runId].ts"
  git commit -m "feat(delivery): assembly stage — run state write-back + operator scene order through rerunAssembly

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 21: Checkpoint B UI — ratings + comment + delivered

**Files:**
- Create: `src/components/studio/CheckpointB.tsx`
- Modify: `api/admin/studio/delivery/[runId].ts` (`submit_ratings` action), `src/pages/dashboard/studio/PropertyCommandCenter.tsx`
- Test: extend `api/admin/studio/delivery/__tests__/runId.test.ts`

**Steps:**

- [ ] Extend the route test (failing first): POST `{action:'submit_ratings', overall:4, music:5, voiceover:3, script:4, comment:'pacing felt rushed'}` on a `checkpoint_b` run → 200, `recordMlEvent('r1','rating', { overall:4, music:5, voiceover:3, script:4 })`, `recordMlEvent('r1','comment', expect.objectContaining({ raw:'pacing felt rushed' }))`, `advanceRun('r1','delivered')`; ratings outside 1–5 → 400; empty comment skips the `comment` event. Mock `lib/delivery/parse-feedback` (`parseFeedbackComment` resolving `{ tags: [...] }`). Run — FAIL.
- [ ] Add the action (parser lands in Task 22; until then the dynamic import is mocked in tests and a try/catch keeps raw-comment storage working even if parsing fails):
  ```ts
  case 'submit_ratings': {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'not_found' });
    const ratings: Record<string, number> = {};
    for (const k of ['overall', 'music', 'voiceover', 'script'] as const) {
      const v = Number(req.body?.[k]);
      if (!Number.isInteger(v) || v < 1 || v > 5) return res.status(400).json({ error: `${k} must be an integer 1-5` });
      ratings[k] = v;
    }
    const { recordMlEvent, advanceRun } = await import('../../../../lib/delivery/runs.js');
    await recordMlEvent(runId, 'rating', ratings);
    const comment = String(req.body?.comment ?? '').trim();
    if (comment) {
      let tags: unknown = [];
      try {
        const { parseFeedbackComment } = await import('../../../../lib/delivery/parse-feedback.js');
        tags = (await parseFeedbackComment(comment, { runId, propertyId: run.property_id })).tags;
      } catch (err) {
        console.error('[delivery] feedback parse failed (storing raw only):', err);
      }
      await recordMlEvent(runId, 'comment', { raw: comment, tags });
    }
    const updated = await advanceRun(runId, 'delivered');
    return res.status(200).json({ run: updated });
  }
  ```
- [ ] Create `src/components/studio/CheckpointB.tsx`: shows the rendered `horizontal_video_url` `<video controls>`, four star rows (Overall / Music / Voiceover / Script — 5 `lucide-react` `Star` buttons each, filled via `fill="currentColor"` when ≤ selected), a comment `.studio-textarea`, and "Mark delivered" which POSTs `submit_ratings` (disabled until all four are rated). On success the stepper shows Delivered.
- [ ] Wire into `PropertyCommandCenter.tsx` for stage `'checkpoint_b'`; also render a static "Delivered" summary card for stage `'delivered'`. Run route tests; `npx vite build` — exit 0.
- [ ] Commit:
  ```bash
  git add src/components/studio/CheckpointB.tsx "api/admin/studio/delivery/[runId].ts" api/admin/studio/delivery/__tests__/runId.test.ts src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): checkpoint B — four 1-5 ratings + comment + delivered transition

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 22: Comment parser (Haiku 4.5) — TDD

**Files:**
- Create: `lib/delivery/parse-feedback.ts`, `lib/delivery/parse-feedback.test.ts`

**Steps:**

- [ ] Write the failing test `lib/delivery/parse-feedback.test.ts` (mock the Anthropic SDK — test the validation, not the model):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const mockCreate = vi.fn();
  vi.mock('@anthropic-ai/sdk', () => ({
    default: class { messages = { create: mockCreate }; },
  }));
  vi.mock('../db.js', () => ({ recordCostEvent: vi.fn().mockResolvedValue(undefined) }));

  import { parseFeedbackComment, validateFeedbackTags, FEEDBACK_CATEGORIES } from './parse-feedback';

  const usage = { input_tokens: 100, output_tokens: 50 };

  beforeEach(() => mockCreate.mockReset());

  describe('validateFeedbackTags', () => {
    it('keeps only allowed categories and sentiment values', () => {
      expect(validateFeedbackTags([
        { category: 'pacing', sentiment: 'negative', note: 'rushed' },
        { category: 'invented_thing', sentiment: 'negative', note: 'x' },
        { category: 'music_fit', sentiment: 'sideways', note: 'x' },
      ])).toEqual([{ category: 'pacing', sentiment: 'negative', note: 'rushed' }]);
    });
    it('non-array input -> empty', () => {
      expect(validateFeedbackTags('garbage')).toEqual([]);
    });
  });

  describe('parseFeedbackComment', () => {
    it('parses model JSON into validated tags and records cost', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"tags":[{"category":"voice_tone","sentiment":"positive","note":"warm read"}]}' }],
        usage,
      });
      const out = await parseFeedbackComment('loved the warm voice', { runId: 'r1', propertyId: 'p1' });
      expect(out.tags).toEqual([{ category: 'voice_tone', sentiment: 'positive', note: 'warm read' }]);
    });
    it('model returning junk -> empty tags, no throw', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }], usage });
      const out = await parseFeedbackComment('hmm', { runId: 'r1', propertyId: 'p1' });
      expect(out.tags).toEqual([]);
    });
  });

  it('exposes the locked category list', () => {
    expect(FEEDBACK_CATEGORIES).toEqual(['pacing', 'voice_tone', 'clip_quality', 'music_fit', 'script_style', 'other']);
  });
  ```
- [ ] Run `npx vitest run lib/delivery/parse-feedback.test.ts` — FAIL. Create `lib/delivery/parse-feedback.ts`:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  import { computeClaudeCost } from '../utils/claude-cost.js';
  import { recordCostEvent } from '../db.js';

  const MODEL = 'claude-haiku-4-5-20251001'; // repo convention (prompt-lab chat endpoints)

  export const FEEDBACK_CATEGORIES = ['pacing', 'voice_tone', 'clip_quality', 'music_fit', 'script_style', 'other'] as const;
  export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
  const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;

  export interface FeedbackTag {
    category: FeedbackCategory;
    sentiment: (typeof SENTIMENTS)[number];
    note: string;
  }

  /** Drop anything outside the locked category/sentiment vocab. Never throws. */
  export function validateFeedbackTags(input: unknown): FeedbackTag[] {
    if (!Array.isArray(input)) return [];
    return input.filter((t): t is FeedbackTag =>
      t != null && typeof t === 'object'
      && (FEEDBACK_CATEGORIES as readonly string[]).includes((t as FeedbackTag).category)
      && (SENTIMENTS as readonly string[]).includes((t as FeedbackTag).sentiment)
      && typeof (t as FeedbackTag).note === 'string',
    );
  }

  const SYSTEM_PROMPT = `You convert an operator's freeform feedback about a real-estate listing video into structured tags.
  Return ONLY JSON: {"tags":[{"category":"<one of: pacing, voice_tone, clip_quality, music_fit, script_style, other>","sentiment":"positive|negative|neutral","note":"<short paraphrase>"}]}
  One tag per distinct point. Empty comment -> {"tags":[]}.`;

  export async function parseFeedbackComment(
    comment: string,
    ctx: { runId: string; propertyId: string },
  ): Promise<{ tags: FeedbackTag[] }> {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: comment }],
    });
    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    const cost = computeClaudeCost(response.usage as never, MODEL);
    await recordCostEvent({
      propertyId: ctx.propertyId, stage: 'analysis', provider: 'anthropic',
      unitsConsumed: cost.totalTokens, unitType: 'tokens', costCents: cost.costCents,
      metadata: {
        delivery_run_id: ctx.runId, subtype: 'feedback_parse', model: MODEL,
        input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens,
      },
    }).catch((e) => console.error('[delivery/parse-feedback] cost_event failed:', e));

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      const parsed = JSON.parse(cleaned) as { tags?: unknown };
      return { tags: validateFeedbackTags(parsed.tags) };
    } catch {
      return { tags: [] }; // raw comment is stored regardless (Task 21)
    }
  }
  ```
- [ ] `npx vitest run lib/delivery/parse-feedback.test.ts` — 5 passing. `npx vitest run lib/delivery api/admin/studio/delivery` — all green.
- [ ] Commit:
  ```bash
  git add lib/delivery/parse-feedback.ts lib/delivery/parse-feedback.test.ts
  git commit -m "feat(delivery): Haiku feedback comment parser with locked category vocabulary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 23: Per-run cost breakdown in the Command Center cost panel

**Files:**
- Modify: `api/admin/studio/properties/[id].ts` (cost query, lines 16 + 21–26 + 33), `src/pages/dashboard/studio/PropertyCommandCenter.tsx` (cost panel section)

**Steps:**

- [ ] In `api/admin/studio/properties/[id].ts` change the cost select to include metadata + stage aggregation:
  ```ts
  db.from('cost_events').select('stage, provider, cost_cents, metadata').eq('property_id', id),
  ```
  and after the existing by-provider loop, add:
  ```ts
  const deliveryByStage: Record<string, number> = {};
  let deliveryTotal = 0;
  for (const r of (cRes.data ?? []) as Array<{ stage: string; cost_cents: number; metadata: { delivery_run_id?: string } | null }>) {
    if (r.metadata?.delivery_run_id && dRes.data && r.metadata.delivery_run_id === (dRes.data as { id: string }).id) {
      deliveryByStage[r.stage] = (deliveryByStage[r.stage] ?? 0) + (r.cost_cents ?? 0);
      deliveryTotal += r.cost_cents ?? 0;
    }
  }
  ```
  and extend the response: `cost: { total_cents: costTotal, by_provider: costByProvider, delivery: dRes.data ? { total_cents: deliveryTotal, by_stage: deliveryByStage } : null }`.
- [ ] In `PropertyCommandCenter.tsx` extend `CostBundle` with `delivery: { total_cents: number; by_stage: Record<string, number> } | null;` and, inside the existing cost section, render (only when `cost.delivery`) a "Delivery run" sub-block: total via the existing `formatCents`, then one row per stage sorted descending. Stage keys render as-is (`generation`, `qc`, `scripting`, `analysis`, `assembly`).
- [ ] `npx vite build` — exit 0. Manual check on a delivery property: breakdown shows judge (qc/google), B-variant generation, script, music/VO assembly rows.
- [ ] Commit:
  ```bash
  git add "api/admin/studio/properties/[id].ts" src/pages/dashboard/studio/PropertyCommandCenter.tsx
  git commit -m "feat(delivery): per-run cost breakdown (metadata.delivery_run_id) in Command Center cost panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

## Task 24: Final verification + HANDOFF + smoke notes

**Files:**
- Modify: `docs/HANDOFF.md` (append a session entry to "Right now" + shipping log — NEVER delete existing content; archive-don't-delete rule applies to all docs)

**Steps:**

- [ ] Run the full suite: `npm test`. Expected: all new tests pass; the ONLY pre-existing failure allowed is `src/v2/components/landing/MarketComparison.test.tsx` (plus the known env-only `extract-photos`/jszip failure if this worktree lacks the install). Any other failure = fix before proceeding.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — clean (no new errors vs baseline).
- [ ] Run `npx vite build` — `✓ built`, exit 0 (this is the gate tsc can't provide).
- [ ] Smoke scripts (spec testing section — run manually, real spend, document results in HANDOFF):
  - Redfin: `pnpm exec tsx -e "import('./lib/mls/scrape-redfin.js').then(m => m.scrapeRedfinByAddress('470 Sorrento Ct, Punta Gorda, FL 33950', null).then(r => console.log(JSON.stringify(r, null, 2))))"` — expect price/beds/baths/sqft/description populated.
  - Creatomate Brand.phone: confirm via the Task 4 coverage panel that the active template exposes `Text-Phone-Number.text` (green when client phone set); a full render with `Brand.phone` requires the manual Creatomate-dashboard placeholder step (out of scope per spec — surfaced by the gray badges).
- [ ] Append to `docs/HANDOFF.md` "Right now": one paragraph — operator delivery pipeline built on `feat/operator-delivery` (client-picker auth fix; migrations 076+077 — note whether applied to the shared Supabase yet; A/B + judge + checkpoints + ml_events + per-run costs; customer flow untouched/gated; NOT merged — prod gates: apply migrations, merge PR, first real run). Add a shipping-log line with today's date + the head commit SHA.
- [ ] Commit:
  ```bash
  git add docs/HANDOFF.md
  git commit -m "docs(handoff): operator delivery pipeline session entry + verification results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```
- [ ] Do NOT push — per Oliver's standing rule, wait for explicit go-ahead (feature branch push is allowed, but flag the two unapplied migrations and get the apply approved first since the DB is shared with prod).

---

## Spec-coverage self-review (done at plan time)

| Spec section | Task(s) |
|---|---|
| W1 bug (picker fetch/auth swallowed) + error/retry | 1 |
| W1 schema 076 brokerage + precedence | 3 |
| W1 phone normalize/display/as-you-type + Brand.phone key | 2, 3 |
| W1 Creatomate field-seeking coverage panel | 4 |
| W2 data model (delivery_runs/scene_variants/ml_events, RLS) | 5 |
| Stage machine, resumable, transitions only via lib | 6, 7 |
| Stage 1 intake (video type, run insert, async scrape, miss→manual) | 8, 9 |
| Stage 2 generate (two runs/scene, variants persisted, B-failure degrade) | 10 |
| Stage 3 judge (Gemini pairs, winner_source=gemini, draft order) | 11, 12 |
| Stage 4 checkpoint A (reorder/regenerate/flip → ml_events) | 13, 14, 15 |
| Stage 5 details (prefill, edit, logged) | 9, 16 |
| Stage 6 voiceover (Sonnet script, editable, V3 roster + client voice, audio) | 17, 18 |
| Stage 7 music (library-first 3 + generate-new joins library) | 19 |
| Stage 8 assemble (brand kit + overlays + VO + music via rerunAssembly) | 20 |
| Stage 9 checkpoint B (4 ratings + comment + Haiku tags + delivered) | 21, 22 |
| Error handling (per-stage error/retry, retry-once-then-skip for ElevenLabs) | 7 (retry), 8 (scrape), 18 (VO retry-once), 19 (music skip) |
| Cost tracking (every call, metadata.delivery_run_id, Command Center panel) | 10, 11, 17, 18, 19, 22, 23 |
| Testing (unit: transitions/judge/phone/parser/music/degradation; smoke; vite build; baseline failure) | every task + 24 |
| Out of scope (ML training, customer exposure, template authoring, views-tracker) | respected — no tasks |
