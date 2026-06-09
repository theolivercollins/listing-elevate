# Operator Studio "Share" Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Vimeo-style **Share** tab to Operator Studio where an operator uploads creatives or pulls existing rendered property videos, configures presentation/embed/download/privacy settings per creative, and shares via public token links.

**Architecture:** New `creatives` table (asset metadata + share settings + unique `share_token`, service-role only, mirrors `property_previews`). Private `creatives` storage bucket with signed-URL playback so download/expiry/password are actually enforced. Public token API `/api/share/[token]` + admin CRUD under `/api/admin/studio/creatives/*`. Public React pages `/v/:token` (presentation) and `/embed/:token` (iframe). Admin UI under Studio styled with `.studio-*` / `--le-*` tokens.

**Tech Stack:** React + Vite + React Router, Supabase (Postgres + Storage, service-role from Vercel serverless funcs under `/api`), TypeScript, existing Vitest test suite.

**Spec:** `docs/specs/2026-06-08-operator-studio-share-tab-design.md`

**Conventions to honor:**
- Admin writes guard: `process.env.VERCEL_ENV === 'production' || process.env.LE_ALLOW_NONPROD_WRITES === 'true'` before any mutation.
- Service-role Supabase client server-side only (see `lib/operator-studio/*` and `api/admin/studio/*` for the existing pattern). Browser never touches `creatives` with the anon key.
- No new monospace fonts. Use `.studio-*` classes and `--le-*` tokens.
- `docs/HANDOFF.md` gets a shipping-log line before merge to `main`.

---

## Data Contract (shared by all tasks — do not drift)

```ts
// lib/operator-studio/creatives-types.ts
export type CreativeSource = 'upload' | 'render';
export type CreativeKind = 'video' | 'image';
export type CreativeVisibility = 'unlisted' | 'public';

export interface CreativeRow {
  id: string;
  title: string;
  description: string | null;
  source: CreativeSource;
  kind: CreativeKind;
  bucket: string;
  storage_path: string | null;
  public_url: string | null;
  thumbnail_url: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  property_id: string | null;
  share_token: string;
  visibility: CreativeVisibility;
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  password_hash: string | null;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Public share payload (no secrets)
export interface SharePayload {
  title: string;
  description: string | null;
  kind: CreativeKind;
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  playbackUrl: string;       // signed (upload) or public (render)
  posterUrl: string | null;
  downloadUrl: string | null; // present only when allow_download
  width: number | null;
  height: number | null;
}
```

Admin list item adds computed `shareUrl` (`/v/{token}`) and `embedUrl` (`/embed/{token}`).

---

## Task 1: Migration — `creatives` table + view RPC

**Files:**
- Create: `supabase/migrations/075_creatives.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 075_creatives.sql — Vimeo-style shareable creatives for Operator Studio
create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  source text not null check (source in ('upload','render')),
  kind text not null check (kind in ('video','image')),
  bucket text not null,
  storage_path text,
  public_url text,
  thumbnail_url text,
  mime_type text,
  duration_seconds numeric,
  width int,
  height int,
  file_size_bytes bigint,
  property_id uuid references public.properties(id) on delete set null,
  share_token text not null unique,
  visibility text not null default 'unlisted' check (visibility in ('unlisted','public')),
  allow_download boolean not null default false,
  allow_embed boolean not null default true,
  presentation_enabled boolean not null default true,
  password_hash text,
  expires_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creatives_created_at_idx on public.creatives (created_at desc);
create index if not exists creatives_property_id_idx on public.creatives (property_id);

alter table public.creatives enable row level security;
-- No anon/auth policies: service-role only (matches property_previews).

create or replace function public.increment_creative_view(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.creatives
     set view_count = view_count + 1,
         last_viewed_at = now()
   where share_token = p_token;
$$;
```

- [ ] **Step 2: Apply via Supabase MCP `apply_migration`** (name `075_creatives`). Production DB is shared (ref `vrhmaeywqsohlztoouxu`) — this is additive/non-destructive (new table + function), allowed. Confirm with `list_tables` that `creatives` exists.

- [ ] **Step 3: Create the private storage bucket** `creatives` (private) via SQL or MCP:

```sql
insert into storage.buckets (id, name, public)
values ('creatives','creatives', false)
on conflict (id) do nothing;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_creatives.sql
git commit -m "feat(share): creatives table + view RPC + private bucket"
```

---

## Task 2: Server helpers — `lib/operator-studio/creatives.ts`

**Files:**
- Create: `lib/operator-studio/creatives-types.ts` (the Data Contract above)
- Create: `lib/operator-studio/creatives.ts`
- Test: `lib/operator-studio/__tests__/creatives.test.ts` (match existing test location/runner — check a sibling test first)

Responsibilities: token generation, password hashing/verify, share-settings
enforcement (pure function), and building the `SharePayload` incl. signed URL
selection. Use the existing service-role Supabase client helper (find it: grep
`createClient` under `lib/` / `api/admin/studio/*` and reuse the same one;
preview-tokens.js is the reference for token gen).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { generateShareToken, hashPassword, verifyPassword, evaluateShareAccess } from '../creatives';

describe('share token', () => {
  it('generates a 32-char base32 token', () => {
    const t = generateShareToken();
    expect(t).toMatch(/^[a-z2-7]{32}$/);
  });
  it('is unique across calls', () => {
    expect(generateShareToken()).not.toEqual(generateShareToken());
  });
});

describe('password', () => {
  it('verifies a correct password and rejects wrong', () => {
    const h = hashPassword('hunter2');
    expect(verifyPassword('hunter2', h)).toBe(true);
    expect(verifyPassword('nope', h)).toBe(false);
  });
});

describe('evaluateShareAccess', () => {
  const base = { presentation_enabled: true, password_hash: null, expires_at: null };
  it('allows when open', () => {
    expect(evaluateShareAccess({ ...base }, { now: new Date('2026-01-01'), password: null }).status).toBe('ok');
  });
  it('blocks when expired', () => {
    expect(evaluateShareAccess({ ...base, expires_at: '2025-01-01T00:00:00Z' }, { now: new Date('2026-01-01'), password: null }).status).toBe('expired');
  });
  it('requires password when set and missing/wrong', () => {
    const h = hashPassword('pw');
    expect(evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: null }).status).toBe('password_required');
    expect(evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: 'bad' }).status).toBe('password_required');
    expect(evaluateShareAccess({ ...base, password_hash: h }, { now: new Date(), password: 'pw' }).status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm exec vitest run lib/operator-studio/__tests__/creatives.test.ts`

- [ ] **Step 3: Implement**

```ts
import crypto from 'node:crypto';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function generateShareToken(len = 32): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += B32[bytes[i] % 32];
  return out;
}

export function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw, 'utf8').digest('hex');
}
export function verifyPassword(pw: string, hash: string | null): boolean {
  if (!hash) return true;
  return hashPassword(pw) === hash;
}

type AccessRow = { presentation_enabled: boolean; password_hash: string | null; expires_at: string | null };
export function evaluateShareAccess(
  row: AccessRow,
  opts: { now: Date; password: string | null },
): { status: 'ok' | 'expired' | 'password_required' | 'disabled' } {
  if (row.expires_at && new Date(row.expires_at) <= opts.now) return { status: 'expired' };
  if (row.password_hash && !verifyPassword(opts.password ?? '', row.password_hash)) return { status: 'password_required' };
  return { status: 'ok' };
}
```

Plus (no separate test required, exercised in API tests): `buildSharePayload(row, signedUrl)` that maps a `CreativeRow` + resolved playback URL → `SharePayload`, setting `downloadUrl` only when `allow_download`; and `getPlaybackUrl(row, supabase)` that returns `row.public_url` for `source='render'` else mints a 2h signed URL from the private bucket via `supabase.storage.from(row.bucket).createSignedUrl(row.storage_path, 7200)`.

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(share): server helpers (tokens, password, access enforcement)`

---

## Task 3: Public share API — `api/share/[token].ts`

**Files:**
- Create: `api/share/[token].ts`
- Modify: `vercel.json` (add rewrite `"/api/share/([^/]+)" -> "/api/share/[token]?token=$1"`, mirroring the existing `/api/preview` rule)
- Test: `api/__tests__/share-token.test.ts` (follow the existing api test pattern if one exists; otherwise unit-test the handler by importing it and passing mock req/res like the preview tests do — check `api/preview` tests first)

- [ ] **Step 1: Write failing test** covering: unknown token → 404; expired → 410; password set + no password → 401 `{requiresPassword:true}`; open render creative → 200 with `playbackUrl === public_url` and `view_count` increment called.

```ts
// Pseudocode shape — mirror the project's existing api test harness.
// Mocks the service-role supabase client returning a fixture CreativeRow.
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement handler**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceClient } from '../../lib/operator-studio/supabase'; // reuse existing
import { evaluateShareAccess, buildSharePayload, getPlaybackUrl, getDownloadUrl } from '../../lib/operator-studio/creatives';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(400).json({ error: 'missing token' });
  const password = req.method === 'POST' ? String((req.body?.password) ?? '') : (req.query.password ? String(req.query.password) : null);

  const supabase = getServiceClient();
  const { data: row } = await supabase.from('creatives').select('*').eq('share_token', token).maybeSingle();
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!row.presentation_enabled && req.query.ctx !== 'embed') return res.status(404).json({ error: 'not available' });

  const access = evaluateShareAccess(row, { now: new Date(), password });
  if (access.status === 'expired') return res.status(410).json({ error: 'expired' });
  if (access.status === 'password_required') return res.status(401).json({ requiresPassword: true });

  const playbackUrl = await getPlaybackUrl(row, supabase);
  const downloadUrl = row.allow_download ? await getDownloadUrl(row, supabase) : null;
  await supabase.rpc('increment_creative_view', { p_token: token });
  return res.status(200).json(buildSharePayload(row, playbackUrl, downloadUrl));
}
```

(Embed page passes `?ctx=embed`; if `allow_embed=false` the embed React page shows a refusal — enforce `allow_embed` here too: when `ctx==='embed'` and `!row.allow_embed`, return 403.)

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(share): public /api/share/[token] route`

---

## Task 4: Admin creatives API — list / create / patch / delete / renders / upload-url

**Files:**
- Create: `api/admin/studio/creatives/index.ts` (GET list, POST create)
- Create: `api/admin/studio/creatives/[id].ts` (PATCH, DELETE)
- Create: `api/admin/studio/creatives/renders.ts` (GET property videos for picker)
- Create: `api/admin/studio/creatives/upload-url.ts` (POST signed upload token)
- Modify: `vercel.json` rewrites for the dynamic `[id]` route (mirror existing `/api/admin/studio/properties/[id]` rules).
- Test: `api/__tests__/admin-creatives.test.ts`

Each write route must start with the prod-write guard:

```ts
const writesAllowed = process.env.VERCEL_ENV === 'production' || process.env.LE_ALLOW_NONPROD_WRITES === 'true';
if (!writesAllowed && req.method !== 'GET') return res.status(403).json({ error: 'writes disabled in this environment' });
```

- [ ] **Step 1: Write failing tests** — POST `mode:'upload'` inserts row with generated token + `source='upload'`; POST `mode:'render'` resolves property video URL into `public_url`; PATCH updates settings and hashes `password`; DELETE removes row (and storage object for uploads); write guard returns 403 when disabled. GET list returns rows with `shareUrl`/`embedUrl`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** all four files. Key bits:
  - `index.ts` POST upload: validate `storage_path,title,kind`; `generateShareToken()`; insert; return row + computed urls.
  - `index.ts` POST render: load property `horizontal_video_url`/`vertical_video_url` by `property_id`+`orientation`; 422 if missing; insert with `public_url`, `bucket='property-videos'`, `source='render'`.
  - `renders.ts`: `select id,address,horizontal_video_url,vertical_video_url from properties where horizontal_video_url is not null or vertical_video_url is not null order by created_at desc`.
  - `upload-url.ts`: `supabase.storage.from('creatives').createSignedUploadUrl(path)` → `{ path, token, signedUrl }`. Build path `${randomId}/${Date.now()}_${sanitized}`.
  - `[id].ts` PATCH: whitelist updatable fields; if `password` present, set `password_hash = password ? hashPassword(password) : null`; never accept `password_hash` directly; `updated_at = now()`.
  - `[id].ts` DELETE: fetch row; if `source==='upload'` `supabase.storage.from(bucket).remove([storage_path])`; then delete row.

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(share): admin creatives CRUD + renders picker + signed upload`

---

## Task 5: Client API helper — `src/lib/share-api.ts`

**Files:**
- Create: `src/lib/share-api.ts`
- Test: `src/lib/__tests__/share-api.test.ts` (mock `fetch`; mirror `src/lib/api.ts` test style if present)

Functions (typed against the Data Contract): `listCreatives()`, `getUploadUrl(file)`, `uploadCreativeFile(file, onProgress)` (gets signed url, PUTs, reads metadata via temp `<video>/<img>`), `createUploadCreative(meta)`, `listRenders()`, `createRenderCreative({property_id,orientation,title})`, `patchCreative(id, patch)`, `deleteCreative(id)`.

- [ ] **Step 1–2: Failing test** for `patchCreative` building the right request (method PATCH, JSON body) and `listCreatives` parsing the array. Run, verify fail.
- [ ] **Step 3: Implement** thin `fetch` wrappers to `/api/admin/studio/creatives*`. Reuse auth header approach from `src/lib/api.ts` (Supabase session bearer).
- [ ] **Step 4: Pass. Step 5: Commit** — `feat(share): client share-api helper`

---

## Task 6: Public viewer pages — `/v/:token`, `/embed/:token`

**Files:**
- Create: `src/pages/share/Presentation.tsx`
- Create: `src/pages/share/Embed.tsx`
- Create: `src/pages/share/useShareData.ts` (hook: fetch `/api/share/:token`, handle password/expiry/loading states)
- Create: `src/styles/share-public.css` (scoped, dark full-screen player styles — no monospace)
- Modify: `src/App.tsx` — add **public** routes `/v/:token` → `Presentation`, `/embed/:token` → `Embed`, OUTSIDE `RequireAdmin`/dashboard tree.
- Modify: `vercel.json` if SPA fallback needs explicit routes (check how existing `/preview/:token` SPA route is served; replicate).
- Test: `src/pages/share/__tests__/useShareData.test.tsx` (mock fetch: 200, 401 requiresPassword, 410 expired).

- [ ] **Step 1–2:** Failing test for `useShareData` state machine (loading → ok / password / expired / notfound). Run, verify fail.
- [ ] **Step 3:** Implement hook + pages.
  - `Presentation`: centered dark stage, `<video controls poster>` or `<img>`, title/description, download button when `downloadUrl`, password form when `requiresPassword` (re-POST with password), friendly expired/404 states. Branded but minimal.
  - `Embed`: bare responsive 16:9 wrapper, autoplay muted off by default, no site chrome, `<video controls>`; if API returns 403 (embed disabled) show one-line message. Passes `?ctx=embed` to the API.
- [ ] **Step 4:** Tests pass. Manually note route registration.
- [ ] **Step 5: Commit** — `feat(share): public presentation + embed viewer pages`

---

## Task 7: Studio Share tab — nav + page + components

**Files:**
- Modify: `src/components/studio/StudioNav.tsx` — add `{ to: '/dashboard/studio/video/share', label: 'Share', end: false }`.
- Modify: `src/App.tsx` — add admin route `path="video/share" element={<StudioShare/>}` under the existing Studio/RequireAdmin tree (lazy import like siblings).
- Create: `src/pages/dashboard/studio/Share.tsx`
- Create: `src/components/studio/share/ShareLibrary.tsx`
- Create: `src/components/studio/share/CreativeCard.tsx`
- Create: `src/components/studio/share/UploadDropzone.tsx`
- Create: `src/components/studio/share/RenderPicker.tsx`
- Create: `src/components/studio/share/CreativeSettingsPanel.tsx`
- Modify: `src/styles/studio-design.css` — append `.studio-share-*` classes (grid, card, drawer, toggle rows). No monospace.
- Test: `src/components/studio/share/__tests__/CreativeCard.test.tsx` (renders title + visibility badge + view count) and `CreativeSettingsPanel.test.tsx` (toggling download calls onPatch with `allow_download`).

- [ ] **Step 1–2:** Failing component tests (React Testing Library, mirror existing studio component tests). Run, verify fail.
- [ ] **Step 3:** Implement:
  - `Share.tsx`: `StudioShell` + `StudioNav` + page heading "Share"; toolbar (Upload, Add from renders); `ShareLibrary`; selected-creative `CreativeSettingsPanel` drawer. Loads via `share-api`.
  - `CreativeCard`: poster/thumb, title, kind icon, view count, visibility badge, click→select.
  - `UploadDropzone`: drag/select → `uploadCreativeFile` (progress) → `createUploadCreative` → refresh list.
  - `RenderPicker`: modal listing `listRenders()`, choose property + orientation → `createRenderCreative`.
  - `CreativeSettingsPanel`: live player + sections General/Privacy/Embed/Sharing/Download as specced; embed snippet `<iframe src="{origin}/embed/{token}" …>`; copy buttons; inline QR (small self-contained SVG generator or a tiny existing util — avoid heavy deps); Save → `patchCreative`; Delete → confirm → `deleteCreative`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5: Commit** — `feat(share): Operator Studio Share tab UI`

---

## Task 8: Integration, real verification, docs, PR

**Files:**
- Modify: `docs/HANDOFF.md` (shipping-log line + Right-now if it shifts)

- [ ] **Step 1:** `pnpm run doctor` and the full test suite `pnpm exec vitest run` — all green (existing 703 + new).
- [ ] **Step 2:** Typecheck the risky surface (no build-time tsc gate exists): `pnpm exec tsc --noEmit` on changed files; fix any ReferenceErrors before deploy.
- [ ] **Step 3:** Real end-to-end on the dev/preview deploy (set `LE_ALLOW_NONPROD_WRITES=true` there): upload a small video → appears as card → set embed on, download on, expiry in future → open `/v/:token` (plays via signed URL), confirm download button works, confirm `/embed/:token` renders, confirm `view_count` increments; set a password → confirm gate; set expiry in past → confirm 410. Pull a render → confirm public URL plays.
- [ ] **Step 4:** Update `docs/HANDOFF.md` shipping log (date + commit + "Operator Studio Share tab: upload/pull creatives, presentation/embed/download/privacy, signed-URL playback").
- [ ] **Step 5:** Push the feature branch, open a PR to `main` (`git merge --no-ff` path per branch model). **Do not merge to `main` / deploy to prod without Oliver's explicit go-ahead** (global rule). Present the PR + preview URL for final approval.

---

## Self-Review notes

- Spec coverage: upload (T2,T4,T5,T7) ✓; pull renders (T4,T5,T7) ✓; presentation (T6) ✓; embed (T3 ctx,T6) ✓; download toggle + signed URL (T2,T3) ✓; privacy/expiry/password (T1,T2,T3,T7) ✓; view tracking (T1,T3) ✓; admin-gated + prod-write guard (T4,T8) ✓; styling tokens (T6,T7) ✓; docs/HANDOFF (T8) ✓.
- Type consistency: `share_token` (not `token`), `allow_download`/`allow_embed`/`presentation_enabled`, `evaluateShareAccess` status enum used uniformly.
- No-placeholder: server-side helper bodies and migration are concrete; UI component bodies are described per-section (acceptable: they follow existing `.studio-*` patterns the implementing agent will read).
```
