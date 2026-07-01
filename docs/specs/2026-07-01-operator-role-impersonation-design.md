# Operator Studio — Full backend role impersonation (Plan B)

Date: 2026-07-01. Status: approved design (Gemini + Codex + orchestrator converged). Risky surface (auth) — server-minted-token design replaces the bypassable header design after cross-model review rejected Plan A.

## Goal
An admin in Operator Studio can impersonate a role (Admin / Agent) and preview BOTH the UI **and** the real backend API responses that role receives. Roles are `admin | user` (product "Agent" == `user`). Privilege may only DE-escalate; impersonation must never grant a non-admin elevated access, and the audit trail must be non-bypassable.

## Why token, not header (cross-model review verdict)
A plain `x-impersonate-role` header honored statelessly is bypassable: an admin can attach it via devtools/curl and never hit the client audit call. So the server mints a token; honoring requires a valid live token row; that row is the authoritative audit record.

## 1. Migration `097_impersonation_sessions.sql`
Table `impersonation_sessions`:
- `id uuid pk default gen_random_uuid()`
- `token_hash text not null unique` — SHA-256 of the raw token (raw token never stored)
- `admin_user_id uuid not null`
- `admin_email text`
- `impersonated_role text not null check (impersonated_role in ('admin','user'))`
- `created_at timestamptz not null default now()`
- `expires_at timestamptz not null` — default 2h from creation
- `revoked_at timestamptz` — null = active
- index on `token_hash`; index on `(admin_user_id, revoked_at)`.
- RLS: enable, NO public policies (server uses service-role `getSupabase()` only).
- The table doubles as the audit trail: created_at = start, revoked_at/expires_at = stop.
- Include `_rollback.sql` (drop table) per repo convention.

## 2. Server `lib/auth.ts`
- `verifyAuth(req, opts?: { ignoreImpersonation?: boolean })`:
  1. Resolve real user + profile from JWT (unchanged).
  2. If `!opts.ignoreImpersonation` AND header `x-impersonate-token` present AND real `profile.role === 'admin'`:
     - sha256 the token; look up `impersonation_sessions` where `token_hash` matches, `revoked_at IS NULL`, `expires_at > now()`, AND `admin_user_id === realUser.id`.
     - if found: return profile with `role` overridden to `session.impersonated_role`, plus `impersonating: { realRole: 'admin', as, sessionId }` (non-persisted field).
     - else: ignore — return real profile unchanged. NEVER escalate. console.warn on a present-but-rejected token.
  3. Type: extend the returned shape with optional `impersonating?`.
- `requireAuth(req,res)` / `requireAdmin(req,res)`: unchanged gating logic. ADD cache-safety: set `res` headers `Cache-Control: private, no-store` and `Vary: Authorization, x-impersonate-token`. (Helper `setNoStore(res)`.) Consequence: admin-impersonating-user → 403 on admin APIs = faithful & desired.

## 3. Endpoint `api/admin/impersonation.ts`
- Method POST. Auth: `verifyAuth(req, { ignoreImpersonation: true })` then assert real `role === 'admin'` (else 403). (Must ignore impersonation so STOP works while impersonating.)
- Strict body validation:
  - `{ action: 'start', role: 'admin'|'user' }` → generate 32-byte random token (`crypto.randomBytes`), insert row (token_hash, admin id+email, role, expires_at = now+2h). Return `{ token, role, expiresAt }`. (Raw token returned once.)
  - `{ action: 'stop' }` → set `revoked_at = now()` on caller's active sessions. Return `{ ok: true }`.
  - reject unknown action / missing/invalid role on start → 400.
- Set `no-store` on responses.

## 4. Client `src/lib/api.ts`
- `getImpersonationToken()` → `sessionStorage['le_impersonate_token']`.
- `apiFetch` and `authedFetch`: after Bearer, if token present AND `!path.startsWith('/api/admin/impersonation')`, add header `x-impersonate-token: <token>`.

## 5. Client `src/lib/auth.tsx`
- state `impersonation: { role: 'admin'|'user'; token: string } | null`, init from sessionStorage keys `le_impersonate_role` + `le_impersonate_token` (both required, else null).
- Context exposes:
  - `profile` — EFFECTIVE profile: when impersonating, `{ ...realProfile, role: impersonation.role }`. Drives every existing `profile.role` consumer (RequireAdmin, sidebar getSections, DashboardIndex, TopNav, SiteNav, Index, Login) automatically — no per-consumer edits, no missed spots.
  - `realProfile`, `realRole` — always the true values.
  - `isImpersonating: boolean`.
  - `setImpersonatedRole(role: 'admin'|'user'|null)`:
    - guard: only when `realRole === 'admin'`; otherwise no-op.
    - role!=null: `await POST /api/admin/impersonation {action:'start', role}`; on success store role+token in sessionStorage + state; on failure surface error and DO NOT switch.
    - role==null: `await POST {action:'stop'}` (best-effort); ALWAYS clear sessionStorage + state locally so Exit can't get stuck.
- `signOut()`: best-effort stop + clear impersonation keys + state.
- Note: `loading`/loader visuals are owned by Task 1 — do not modify those.

## 6. UI
- Launcher: role switcher in `DashboardSidebar` (Operator section), rendered only when `realRole === 'admin'`. Options from a single `IMPERSONATABLE_ROLES = [{value:'admin',label:'Admin'},{value:'user',label:'Agent'}]`. shadcn/ui + Tailwind + Inter; follow `docs/design/DESIGN-GUIDE.md` (no page-level horizontal padding, token scale, no monospace).
- Global banner: mounted at the dashboard shell ROOT (outside the admin-gated route subtree, e.g. in `Dashboard.tsx` shell), shown when `isImpersonating`. "Previewing as Agent" + "Exit preview" → `setImpersonatedRole(null)`. Must be reachable while impersonating `user` (admin chrome hidden) — keyed off `realRole`/`isImpersonating`.

## 7. Coverage / known limits (v1)
- Impersonation faithfully covers: UI role gating + ALL `/api/*` server-mediated data (studio uses `authedFetch`/`apiFetch`).
- Direct `supabase.from()` client reads (e.g. profile/presets) stay under the REAL admin identity + RLS. Not a privilege escalation (real user IS admin; RLS unchanged), but a possible faithfulness gap. Implementer must grep + list these for the studio preview surfaces; documented, not blocking for v1.

## 8. Security invariants
- DE-escalation only; non-admin tokens never honored.
- Role derived from a server-issued, hashed, expiring, revocable token — never from a trusted client string.
- Stateless re-validation every request; no client trust beyond the JWT identity.
- Audit = the session row (start=created_at, stop=revoked_at). Non-bypassable: honoring requires a live row.
- No JWT minting/alteration; token identity always the real admin.
- Cache-safe: `no-store` + `Vary` on authed responses.

## 9. Tests
Server: token honored for admin; ignored for non-admin even with a valid token belonging to an admin; expired/revoked/mismatched-admin ignored; requireAdmin 403s impersonated-user; impersonation endpoint start/stop works with `ignoreImpersonation`; cache headers present.
Client: effective vs real role; start awaits + stores token; failure does not switch; stop + signOut clear; impersonation header NOT attached to `/api/admin/impersonation`.
E2E: admin → Agent: sidebar shows agent sections, admin routes redirect, an admin-only API returns 403, data reflects agent; Exit restores admin.
