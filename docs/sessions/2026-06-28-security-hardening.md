# Session 2026-06-28 — Security Hardening Phase 0

Last updated: 2026-06-28

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state (update shipping log when you push)
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative state
- [../plans/back-on-track-plan.md](../plans/back-on-track-plan.md) — active roadmap

## What shipped

Full-app security audit produced 32 findings (3 critical, 2 high, remainder lower-severity). Phase 0 closes the critical/high surface.

### Migrations applied to prod (Supabase vrhmaeywqsohlztoouxu)

- Commit `6d105a6` / `7ae4756` — `093_security_rls_lockdown_f1.sql`: RLS enabled on all 57 previously-public tables. Anon + authenticated DML grants revoked. `public.is_admin()` helper created. `properties` = owner-or-admin SELECT policy. 5 finance tables (`token_purchases`, `expenses`, `revenue_entries`, `subscriptions`, `cost_events`) = admin-only policies. **Verified: anon REST returns 401 on every locked table.** Closes finding F1 (whole DB was world-readable/writable via the anon key with no RLS whatsoever).
- Commit `7ae4756` — `094_security_view_lockdown_f6.sql`: Anon/authenticated SELECT grants revoked on 5 public views (`lab_prompt_override_readiness`, `prompt_lab_iterations_complete`, `v_judge_calibration_status`, `v_knowledge_map_cells`, `v_rated_pool`). All five set to `security_invoker = true` so queries evaluate the caller's RLS context instead of the view owner's. Closes finding F6.

### Code fixes (deployed via this branch promotion)

- Commit `d873f3a` — F4 (read endpoints): `requireAdmin` added to `api/admin/prompts.ts`, `api/admin/prompt-revisions.ts`, `api/admin/learning.ts`, `api/stats/overview.ts`, `api/stats/daily.ts`.
- Commit `ff6cb66` — F5 (HTTP security headers): `vercel.json` security headers added via `continue: true` route entries — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy` (report-only). Preview-embed route excluded so client share pages remain frameable.
- Commit `a119de8` — Vercel routes/headers conflict fix: resolved `routes` + top-level `headers` coexistence issue that would have broken all deploys.
- Commit `6516913` — F3: `api/properties/[id]/rerun.ts` now owner-or-admin gated + env write-guard.
- Commit `72712b3` — F4 (write endpoints) + F11/F12: `requireAdmin` + env guard on `api/scenes/[id]/approve.ts`, `skip.ts`, `api/admin/recover-kling.ts`; owner/admin IDOR guards on `api/properties/[id].ts` (PATCH), `api/properties/[id]/archive.ts`, `api/scenes/[id]/index.ts` (GET).
- Commit `7ae4756` (also includes F2): `api/pipeline/[propertyId].ts` owner/admin-gated + env write-guard; client callers `src/lib/api.ts` and `src/pages/dashboard/studio/StudioNew.tsx` updated to send the auth token.

### Verification

- 416 tests green (full suite).
- Security-auditor review + code-reviewer sign-off on all code changes.
- Transactional dry-run + Codex peer review performed.
- Anon REST spot-check confirmed 401 on locked tables post-migration.

## What's next

Security backlog F7–F32 in a follow-on session. Highest-priority remaining items:
- F7: service-role key exposure in client bundle / environment variable hygiene
- Input validation gaps (finding class F8–F10)
- Rate limiting on unauthenticated endpoints
- Logging and alerting (finding class F13+)

## What was tried + failed

- `vercel.json` with both top-level `headers` and `routes` arrays — Vercel rejects this combination. Fixed by expressing all headers as `continue: true` route entries instead (commit `a119de8`).

## Questions answered this session

- **Does RLS on all tables break the server?** No. Server uses the service-role key which bypasses RLS entirely. Only the anon/JWT client path is affected.
- **Does `security_invoker=true` on views break existing callers?** No. All existing server-side callers use service-role (bypasses RLS). The change only affects anon/JWT queries, which were already blocked by the table-level policies from migration 093.
- **Migration 094 filename collision with feat/provider-logging-cost-price-accuracy:** Supabase applies migrations by timestamp, not filename order, so the applied state in prod is correct. The filename collision is a docs/repo hygiene issue only — that branch's 094 must be renumbered before it can merge.

## Cost snapshot

No provider API calls this session. All work was code + schema changes.

---

## Follow-up batch (branch `worktree-security-backlog`, 2026-06-28)

Continued from Phase 0. Closes the next tier of the security backlog. No provider API calls.

### Migrations applied to prod (Supabase vrhmaeywqsohlztoouxu)

- Commit `6b7621c` — `095_security_function_search_path_f16.sql`: `search_path` pinned on 14 app functions (finding F16). Prevents search-path injection attacks where an attacker-controlled schema could shadow internal functions. APPLIED TO PROD 2026-06-28.
- `096_security_revoke_internal_rpc_exec_f15.sql`: EXECUTE on `claim_v21_outcomes` + `increment_creative_view` revoked from anon + authenticated roles; service_role kept. These RPCs were reachable by any unauthenticated client (finding F15). APPLIED TO PROD 2026-06-28.

### Code fixes

- Commit `6c029db` — F8 (SSRF): new `lib/security/url-guard.ts` exports `assertAllowedMediaUrl`. Enforces https-only + anchored host allowlist (Bunny CDN, Supabase Storage) and rejects IP literals. Applied before the `fetch()` call in `api/preview/[token]/download.ts` + `api/admin/studio/properties/[id]/download.ts`. Severity reduced post-F1 (anon can no longer set the URL via the API), retained as defense-in-depth.
- Commit `9476b49` — F25 (filter injection): `sanitizePostgrestLike` strips PostgREST `.or()` grammar characters from the `q` parameter in `api/blog/posts/index.ts` before the `.or()` filter is built. Prevents injection of arbitrary PostgREST filter expressions through the blog search endpoint.
- Commit `e5a8919` — F23 (PII logging): removed `console.log` calls in `api/properties/index.ts` that were emitting `address`, `price`, `agentName`, `driveLink`, and `email` to Vercel runtime logs. Customer PII no longer appears in log aggregators.

### Verification

- Security posture certified post-batch: 0 critical / 0 high advisories from advisor scan.
- Anon PostgREST = 401 on all tables/views (confirmed; unchanged from Phase 0).
- Migrations 095 + 096 applied and confirmed in Supabase migration history.

### Remaining tail (deferred — lower severity)

- F7: `api/pipeline/continue/[runId].ts` lacks a `CRON_SECRET`-style shared-secret header check. Add before the endpoint goes under heavy prod load.
- F28: HIBP breach-check toggle on signup.
- F20/F10/F9: optional rate-limiting and additional input validation (lower priority).
