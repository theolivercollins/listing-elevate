# Dashboard Redesign — Stage 1 (Shell + Overview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new vertical-sidebar `DashboardShell`, rewrite the Overview page (4 KPI cards + revenue/spend chart + cost-by-provider donut + recent listings table), and the 4 backing API endpoints. Behind feature flag `VITE_LE_DASHBOARD_V3` so the old TopNav-driven dashboard stays default until proven on dev.

**Architecture:** New components live in `src/v2/components/` (existing convention for redesign work). New API endpoints live in `api/admin/overview/`. Feature flag read via `import.meta.env.VITE_LE_DASHBOARD_V3 === 'true'` in a single helper; `Dashboard.tsx` switches between `<DashboardShell>` (flag ON) and the existing `<Outlet />` only layout (flag OFF). `TopNav.tsx` early-returns on `/dashboard/*` when flag ON. No migrations. Stage 1 must compile + lint clean + `pnpm test` green.

**Tech Stack:** React 18 · Vite · TypeScript · React Router v6 · Tailwind + LE tokens (`src/v2/styles/tokens.css`) · recharts (existing) · vitest + happy-dom · TanStack Query (already used). Backend: Vercel Serverless (Node) + Supabase JS.

**Spec:** [`docs/specs/2026-05-13-admin-dashboard-redesign-design.md`](../specs/2026-05-13-admin-dashboard-redesign-design.md)

**Branch:** `feat/dashboard-redesign-stage-1` off `dev`.

**Definition of done:** With `VITE_LE_DASHBOARD_V3=true` set in `.env.local`, visiting `/dashboard` on `pnpm dev` renders the new shell + Overview page populated by real data. With the flag OFF, the existing dashboard renders unchanged. `pnpm tsc --noEmit` clean. `pnpm test` green. `pnpm lint` clean.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/featureFlags.ts` | Read `VITE_LE_DASHBOARD_V3`. Single source of truth for flag reads. |
| `src/v2/components/dashboard/DashboardShell.tsx` | Layout container — mounts Sidebar + TopBar + `<Outlet />`. |
| `src/v2/components/dashboard/Sidebar.tsx` | Vertical nav. 240px expanded / 64px collapsed. Active-state logic. |
| `src/v2/components/dashboard/SidebarItem.tsx` | Single nav item primitive (icon + label, active state, collapse-aware). |
| `src/v2/components/dashboard/SidebarDropdown.tsx` | Expandable sub-nav group (Orders / Tools / Dev). |
| `src/v2/components/dashboard/TopBar.tsx` | Page-title + theme toggle + avatar dropdown. |
| `src/v2/components/dashboard/KpiCard.tsx` | Gradient-disc + label + value + delta KPI card. |
| `src/v2/components/dashboard/PeriodSelector.tsx` | 7d / 30d / 90d segmented control. |
| `src/v2/components/dashboard/RevenueSpendChart.tsx` | Recharts dual-area chart wrapper. |
| `src/v2/components/dashboard/CostProviderDonut.tsx` | Recharts donut wrapper + center-label. |
| `src/v2/components/dashboard/RecentListingsTable.tsx` | Table primitive — 10 rows, stage pill, links. |
| `src/v2/components/dashboard/SystemHealthBadge.tsx` | Status pill (Healthy/Degraded/Critical) used inside the System Health KPI. |
| `src/v2/components/dashboard/__tests__/` | Component tests (vitest + happy-dom). |
| `api/admin/overview/system-health.ts` | Aggregator: `system_flags` + `cost_events` errors + stuck-property check → `{ status, alerts[] }`. |
| `api/admin/overview/recent-listings.ts` | Top-N listings ordered by `created_at desc` with user email + cost sum. |
| `api/admin/overview/cost-by-provider.ts` | Period-aware `cost_events` sum grouped by provider. |
| `api/admin/overview/revenue-spend-series.ts` | Period-aware daily series — revenue from `revenue_entries`, spend from `cost_events`. |

### Modified files

| Path | Change |
|---|---|
| `src/v2/styles/tokens.css` | Add `--le-gradient-blue`, `--le-gradient-navy`, `--le-gradient-beige`, `--le-gradient-status-healthy/degraded/critical`. Light + dark sets. |
| `src/pages/Dashboard.tsx` | Conditionally mount `<DashboardShell>` when flag ON. |
| `src/pages/dashboard/Overview.tsx` | Full rewrite using new components (Stage 1's biggest single edit). |
| `src/components/TopNav.tsx` | Early-return on `/dashboard/*` when flag ON. |
| `src/lib/api.ts` | Add `fetchOverviewSystemHealth`, `fetchOverviewRecentListings`, `fetchOverviewCostByProvider`, `fetchOverviewRevenueSpendSeries`. |
| `src/lib/types.ts` | Add `OverviewSystemHealth`, `OverviewRecentListing`, `OverviewCostByProviderRow`, `OverviewRevenueSpendPoint` types. |
| `.env.example` | Document `VITE_LE_DASHBOARD_V3` flag. |

### Not touched in Stage 1

Old `Pipeline.tsx`, `Properties.tsx`, `Logs.tsx`, `Finances.tsx`, `Settings.tsx`, all `Development.tsx` subtree, all Blog pages. Those are Stages 2-5.

---

## Tasks

### Task 1: Set up the branch and verify clean baseline

**Files:** none.

- [ ] **Step 1: Confirm `dev` is up to date and clean.**

```bash
cd ~/listing-elevate
git fetch origin
git checkout dev
git pull --ff-only origin dev
git status
```
Expected: clean working tree. If not clean, stop and resolve before continuing.

- [ ] **Step 2: Create the stage-1 branch off `dev`.**

```bash
git checkout -b feat/dashboard-redesign-stage-1
```

- [ ] **Step 3: Verify baseline build is green.**

```bash
pnpm install
pnpm tsc --noEmit
pnpm lint
pnpm test --run
```
Expected: all clean. If any fail, fix on `dev` first via a separate PR (do not fix on this branch — keeps the redesign clean).

- [ ] **Step 4: Move the spec onto the branch.**

```bash
# spec exists in working tree on a different branch — bring it forward
git checkout feat/creatomate-buildout -- docs/specs/2026-05-13-admin-dashboard-redesign-design.md 2>/dev/null || true
# if the spec isn't on any branch, regenerate from the canonical session source
ls docs/specs/2026-05-13-admin-dashboard-redesign-design.md
```
Expected: file exists. If not, copy it from the session transcript before continuing.

- [ ] **Step 5: Commit the spec.**

```bash
git add docs/specs/2026-05-13-admin-dashboard-redesign-design.md docs/plans/2026-05-13-dashboard-redesign-stage-1-plan.md
git commit -m "docs(dashboard): redesign spec + stage-1 plan"
```

---

### Task 2: Feature flag helper

**Files:**
- Create: `src/lib/featureFlags.ts`
- Test: `src/lib/featureFlags.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test.**

Create `src/lib/featureFlags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("isDashboardV3Enabled", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true when VITE_LE_DASHBOARD_V3 is 'true'", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "true");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(true);
  });

  it("returns false when VITE_LE_DASHBOARD_V3 is undefined", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(false);
  });

  it("returns false for any value other than the literal string 'true'", async () => {
    vi.stubEnv("VITE_LE_DASHBOARD_V3", "1");
    const { isDashboardV3Enabled } = await import("./featureFlags");
    expect(isDashboardV3Enabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/lib/featureFlags.test.ts --run
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.**

Create `src/lib/featureFlags.ts`:

```typescript
/**
 * Feature flags read from Vite env. All flags are conservative-default OFF.
 * Add a flag by: (1) declaring its env var here, (2) documenting it in .env.example,
 * (3) reading it via the helper below — never inline `import.meta.env` elsewhere.
 */

export function isDashboardV3Enabled(): boolean {
  return import.meta.env.VITE_LE_DASHBOARD_V3 === "true";
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/lib/featureFlags.test.ts --run
```
Expected: 3/3 PASS.

- [ ] **Step 5: Document in .env.example.**

Append to `.env.example`:

```
# Dashboard v3 redesign (2026-05-13). When true, /dashboard/* renders the new
# sidebar shell + restyled Overview. Default OFF — old TopNav-driven dashboard.
VITE_LE_DASHBOARD_V3=false
```

- [ ] **Step 6: Commit.**

```bash
git add src/lib/featureFlags.ts src/lib/featureFlags.test.ts .env.example
git commit -m "feat(dashboard): VITE_LE_DASHBOARD_V3 feature flag helper"
```

---

### Task 3: Gradient tokens

**Files:**
- Modify: `src/v2/styles/tokens.css`

- [ ] **Step 1: Add light-mode gradients after the existing shadow block (around line 47).**

Find the closing `}` of the `:root {` block in `src/v2/styles/tokens.css`. Before that closing brace, add:

```css
  /* Dashboard redesign — gradient washes (KPI discs + chart fills only) */
  --le-gradient-blue: linear-gradient(135deg, oklch(0.65 0.13 240), oklch(0.5 0.16 245));
  --le-gradient-navy: linear-gradient(135deg, oklch(0.35 0.08 250), oklch(0.22 0.05 250));
  --le-gradient-beige: linear-gradient(135deg, oklch(0.86 0.04 80), oklch(0.78 0.05 75));
  --le-gradient-status-healthy: linear-gradient(135deg, oklch(0.7 0.15 155), oklch(0.55 0.16 155));
  --le-gradient-status-degraded: linear-gradient(135deg, oklch(0.78 0.14 75), oklch(0.62 0.15 75));
  --le-gradient-status-critical: linear-gradient(135deg, oklch(0.68 0.17 25), oklch(0.52 0.18 25));
```

- [ ] **Step 2: Mirror in dark mode.**

Find the closing `}` of the `.dark, [data-theme="dark"]` block. Before that closing brace, add:

```css
  --le-gradient-blue: linear-gradient(135deg, oklch(0.7 0.13 240), oklch(0.55 0.16 245));
  --le-gradient-navy: linear-gradient(135deg, oklch(0.45 0.08 250), oklch(0.3 0.05 250));
  --le-gradient-beige: linear-gradient(135deg, oklch(0.82 0.04 80), oklch(0.72 0.05 75));
  --le-gradient-status-healthy: linear-gradient(135deg, oklch(0.78 0.16 155), oklch(0.62 0.17 155));
  --le-gradient-status-degraded: linear-gradient(135deg, oklch(0.85 0.14 75), oklch(0.7 0.15 75));
  --le-gradient-status-critical: linear-gradient(135deg, oklch(0.78 0.17 25), oklch(0.62 0.18 25));
```

- [ ] **Step 3: Verify CSS compiles (no test — Vite will fail at runtime if invalid).**

```bash
pnpm dev &
sleep 5
curl -sI http://localhost:8080/ | head -1
kill %1
```
Expected: HTTP/1.1 200 OK. If dev fails to compile, tokens.css is broken — read the Vite error.

- [ ] **Step 4: Commit.**

```bash
git add src/v2/styles/tokens.css
git commit -m "feat(dashboard): gradient tokens for KPI discs + chart fills"
```

---

### Task 4: Types for the 4 new Overview endpoints

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Open `src/lib/types.ts` and find the end of the file.**

```bash
tail -10 src/lib/types.ts
```

- [ ] **Step 2: Append the new types.**

Add at the end of `src/lib/types.ts`:

```typescript
// ─── Dashboard v3 Overview ─────────────────────────────────────────

export type OverviewPeriod = "7d" | "30d" | "90d";

export type SystemHealthStatus = "healthy" | "degraded" | "critical";

export interface SystemHealthAlert {
  id: string;
  severity: "degraded" | "critical";
  category: "kill_switch" | "provider_error_rate" | "stuck_property";
  message: string;
  detail?: string;
  link?: string; // optional URL to the System Status page anchor
}

export interface OverviewSystemHealth {
  status: SystemHealthStatus;
  alert_count: number;
  alerts: SystemHealthAlert[];
  generated_at: string;
}

export interface OverviewRecentListing {
  id: string;
  order_id: string | null;
  address: string;
  customer_email: string | null;
  customer_id: string | null;
  status: string;
  cost_cents: number;
  created_at: string;
  thumbnail_url: string | null;
}

export interface OverviewCostByProviderRow {
  provider: string;
  cost_cents: number;
  pct: number; // 0-100
}

export interface OverviewRevenueSpendPoint {
  date: string; // YYYY-MM-DD
  revenue_cents: number;
  spend_cents: number;
}
```

- [ ] **Step 3: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/types.ts
git commit -m "feat(dashboard): types for the 4 Overview endpoints"
```

---

### Task 5: API — `GET /api/admin/overview/system-health`

**Files:**
- Create: `api/admin/overview/system-health.ts`

- [ ] **Step 1: Create the file with the full implementation.**

Create `api/admin/overview/system-health.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/system-health
//
// Aggregates three signals to produce a single status pill + alerts list:
//   1. system_flags — any kill-switch in an unexpected state
//   2. cost_events — provider error rate over last 24h (>5% critical, >1% degraded)
//   3. properties — stuck in any non-terminal status (>60min critical, >15min degraded)
//
// Conservative ordering: critical wins over degraded wins over healthy.

const SINCE_24H = () => new Date(Date.now() - 86_400_000).toISOString();
const STUCK_DEGRADED_MIN_MS = 15 * 60_000;
const STUCK_CRITICAL_MIN_MS = 60 * 60_000;
const TERMINAL_STATES = new Set(["complete", "failed", "archived"]);

const EXPECTED_FLAGS: Record<string, string | boolean> = {
  // judge_cron_paused is currently expected ON per HANDOFF 2026-05-13
  judge_cron_paused: true,
};

type Severity = "healthy" | "degraded" | "critical";

function escalate(current: Severity, next: Severity): Severity {
  const rank = { healthy: 0, degraded: 1, critical: 2 } as const;
  return rank[next] > rank[current] ? next : current;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  const alerts: Array<{
    id: string;
    severity: "degraded" | "critical";
    category: "kill_switch" | "provider_error_rate" | "stuck_property";
    message: string;
    detail?: string;
  }> = [];
  let status: Severity = "healthy";

  // 1) Kill-switches
  const { data: flags, error: flagErr } = await supabase
    .from("system_flags")
    .select("flag, value");
  if (flagErr) return res.status(500).json({ error: flagErr.message });

  for (const row of flags ?? []) {
    const expected = EXPECTED_FLAGS[row.flag];
    if (expected === undefined) continue; // unknown flag — don't alert
    if (row.value !== expected) {
      alerts.push({
        id: `flag:${row.flag}`,
        severity: "degraded",
        category: "kill_switch",
        message: `Kill-switch '${row.flag}' is ${String(row.value)} (expected ${String(expected)})`,
      });
      status = escalate(status, "degraded");
    }
  }

  // 2) Provider error rate over last 24h
  const { data: events24h, error: eErr } = await supabase
    .from("cost_events")
    .select("provider, metadata, created_at")
    .gte("created_at", SINCE_24H());
  if (eErr) return res.status(500).json({ error: eErr.message });

  const perProvider = new Map<string, { total: number; errors: number }>();
  for (const evt of events24h ?? []) {
    const p = (evt.provider as string) ?? "unknown";
    if (!perProvider.has(p)) perProvider.set(p, { total: 0, errors: 0 });
    const bucket = perProvider.get(p)!;
    bucket.total += 1;
    const meta = evt.metadata as Record<string, unknown> | null;
    if (meta && (meta.error || meta.failed === true)) bucket.errors += 1;
  }

  for (const [provider, { total, errors }] of perProvider) {
    if (total < 5) continue; // not enough sample — don't alarm
    const rate = errors / total;
    if (rate > 0.05) {
      alerts.push({
        id: `err:${provider}`,
        severity: "critical",
        category: "provider_error_rate",
        message: `${provider} error rate ${(rate * 100).toFixed(1)}% over last 24h`,
        detail: `${errors} errors in ${total} calls`,
      });
      status = escalate(status, "critical");
    } else if (rate > 0.01) {
      alerts.push({
        id: `err:${provider}`,
        severity: "degraded",
        category: "provider_error_rate",
        message: `${provider} error rate ${(rate * 100).toFixed(1)}% over last 24h`,
        detail: `${errors} errors in ${total} calls`,
      });
      status = escalate(status, "degraded");
    }
  }

  // 3) Stuck properties
  const { data: props, error: pErr } = await supabase
    .from("properties")
    .select("id, status, updated_at, address")
    .not("status", "in", `(${Array.from(TERMINAL_STATES).map((s) => `"${s}"`).join(",")})`);
  if (pErr) return res.status(500).json({ error: pErr.message });

  const now = Date.now();
  for (const prop of props ?? []) {
    if (TERMINAL_STATES.has(prop.status as string)) continue;
    const updated = new Date(prop.updated_at as string).getTime();
    if (Number.isNaN(updated)) continue;
    const ageMs = now - updated;
    if (ageMs > STUCK_CRITICAL_MIN_MS) {
      alerts.push({
        id: `stuck:${prop.id}`,
        severity: "critical",
        category: "stuck_property",
        message: `Listing stuck at status='${prop.status}' for ${Math.round(ageMs / 60_000)}min`,
        detail: prop.address as string,
      });
      status = escalate(status, "critical");
    } else if (ageMs > STUCK_DEGRADED_MIN_MS) {
      alerts.push({
        id: `stuck:${prop.id}`,
        severity: "degraded",
        category: "stuck_property",
        message: `Listing stuck at status='${prop.status}' for ${Math.round(ageMs / 60_000)}min`,
        detail: prop.address as string,
      });
      status = escalate(status, "degraded");
    }
  }

  return res.status(200).json({
    status,
    alert_count: alerts.length,
    alerts,
    generated_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Smoke-test the endpoint locally.**

```bash
pnpm dev &
sleep 5
# Endpoint requires admin auth — easiest path is to hit it from the browser console
# while signed in as an admin. Or use curl with a bearer token if you have one.
# Verify the handler at least returns a 401 (not 500) when unauthenticated:
curl -sI http://localhost:8080/api/admin/overview/system-health | head -1
kill %1
```
Expected: HTTP/1.1 401 (auth required — confirms the handler ran and returned a structured failure, not a 500 from a code error).

- [ ] **Step 4: Commit.**

```bash
git add api/admin/overview/system-health.ts
git commit -m "feat(api): GET /api/admin/overview/system-health"
```

---

### Task 6: API — `GET /api/admin/overview/recent-listings`

**Files:**
- Create: `api/admin/overview/recent-listings.ts`

- [ ] **Step 1: Create the file.**

Create `api/admin/overview/recent-listings.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/recent-listings?limit=10
//
// Replaces the two fetchProperties calls + thumbnail fan-out on the Overview
// page. Returns the latest N properties enriched with customer email + total
// cost from cost_events. Default limit = 10.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt((req.query.limit as string) ?? "", 10) || DEFAULT_LIMIT),
  );

  const supabase = getSupabase();

  const { data: properties, error: pErr } = await supabase
    .from("properties")
    .select("id, order_id, address, status, created_at, user_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!properties || properties.length === 0) {
    return res.status(200).json({ listings: [] });
  }

  const propertyIds = properties.map((p) => p.id as string);
  const userIds = Array.from(
    new Set(properties.map((p) => p.user_id as string | null).filter(Boolean) as string[]),
  );

  // Parallel: cost rollup + user emails + first photo per property
  const [costRes, profileRes, photoRes] = await Promise.all([
    supabase
      .from("cost_events")
      .select("property_id, cost_cents")
      .in("property_id", propertyIds),
    userIds.length
      ? supabase.from("user_profiles").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; email: string }>, error: null }),
    supabase
      .from("photos")
      .select("property_id, storage_url, position")
      .in("property_id", propertyIds)
      .order("position", { ascending: true }),
  ]);

  if (costRes.error) return res.status(500).json({ error: costRes.error.message });
  if (profileRes.error) return res.status(500).json({ error: profileRes.error.message });
  if (photoRes.error) return res.status(500).json({ error: photoRes.error.message });

  const costMap = new Map<string, number>();
  for (const row of costRes.data ?? []) {
    const pid = row.property_id as string;
    costMap.set(pid, (costMap.get(pid) ?? 0) + ((row.cost_cents as number) ?? 0));
  }

  const emailMap = new Map<string, string>();
  for (const row of profileRes.data ?? []) {
    emailMap.set(row.id as string, row.email as string);
  }

  const thumbMap = new Map<string, string>();
  for (const row of photoRes.data ?? []) {
    const pid = row.property_id as string;
    if (!thumbMap.has(pid)) thumbMap.set(pid, row.storage_url as string);
  }

  const listings = properties.map((p) => ({
    id: p.id as string,
    order_id: (p.order_id as string | null) ?? null,
    address: p.address as string,
    customer_id: (p.user_id as string | null) ?? null,
    customer_email: emailMap.get((p.user_id as string) ?? "") ?? null,
    status: p.status as string,
    cost_cents: costMap.get(p.id as string) ?? 0,
    created_at: p.created_at as string,
    thumbnail_url: thumbMap.get(p.id as string) ?? null,
  }));

  return res.status(200).json({ listings });
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add api/admin/overview/recent-listings.ts
git commit -m "feat(api): GET /api/admin/overview/recent-listings"
```

---

### Task 7: API — `GET /api/admin/overview/cost-by-provider`

**Files:**
- Create: `api/admin/overview/cost-by-provider.ts`

- [ ] **Step 1: Create the file.**

Create `api/admin/overview/cost-by-provider.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/cost-by-provider?period=30d
//
// Period-aware rollup of cost_events.cost_cents grouped by provider.
// Returns rows sorted by cost_cents desc, plus pct of total per row.

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const period = (req.query.period as string) ?? "30d";
  const periodMs = PERIOD_MS[period];
  if (!periodMs) return res.status(400).json({ error: `unknown period '${period}'` });

  const since = new Date(Date.now() - periodMs).toISOString();
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("cost_events")
    .select("provider, cost_cents")
    .gte("created_at", since);
  if (error) return res.status(500).json({ error: error.message });

  const byProvider = new Map<string, number>();
  for (const row of data ?? []) {
    const p = (row.provider as string) ?? "unknown";
    byProvider.set(p, (byProvider.get(p) ?? 0) + ((row.cost_cents as number) ?? 0));
  }

  const total = Array.from(byProvider.values()).reduce((a, b) => a + b, 0);
  const rows = Array.from(byProvider.entries())
    .map(([provider, cost_cents]) => ({
      provider,
      cost_cents,
      pct: total === 0 ? 0 : (cost_cents / total) * 100,
    }))
    .sort((a, b) => b.cost_cents - a.cost_cents);

  return res.status(200).json({ rows, total_cents: total, period });
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit.**

```bash
git add api/admin/overview/cost-by-provider.ts
git commit -m "feat(api): GET /api/admin/overview/cost-by-provider"
```

---

### Task 8: API — `GET /api/admin/overview/revenue-spend-series`

**Files:**
- Create: `api/admin/overview/revenue-spend-series.ts`

- [ ] **Step 1: Create the file.**

Create `api/admin/overview/revenue-spend-series.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET /api/admin/overview/revenue-spend-series?period=30d
//
// Daily series for the Overview revenue/spend dual-area chart.
// Revenue from revenue_entries (manual entries — Stripe-derived or hand-typed).
// Spend from cost_events.cost_cents.

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

function dateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const period = (req.query.period as string) ?? "30d";
  const periodMs = PERIOD_MS[period];
  if (!periodMs) return res.status(400).json({ error: `unknown period '${period}'` });

  const since = new Date(Date.now() - periodMs).toISOString();
  const supabase = getSupabase();

  const [revRes, spendRes] = await Promise.all([
    supabase
      .from("revenue_entries")
      .select("amount_cents, occurred_at")
      .gte("occurred_at", since),
    supabase
      .from("cost_events")
      .select("cost_cents, created_at")
      .gte("created_at", since),
  ]);
  if (revRes.error) return res.status(500).json({ error: revRes.error.message });
  if (spendRes.error) return res.status(500).json({ error: spendRes.error.message });

  // Build a date-keyed map covering every day in the period
  const series = new Map<string, { revenue_cents: number; spend_cents: number }>();
  const startMs = Date.now() - periodMs;
  const days = Math.ceil(periodMs / 86_400_000);
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * 86_400_000);
    series.set(dateKey(d.toISOString()), { revenue_cents: 0, spend_cents: 0 });
  }

  for (const row of revRes.data ?? []) {
    const k = dateKey(row.occurred_at as string);
    const bucket = series.get(k);
    if (bucket) bucket.revenue_cents += (row.amount_cents as number) ?? 0;
  }

  for (const row of spendRes.data ?? []) {
    const k = dateKey(row.created_at as string);
    const bucket = series.get(k);
    if (bucket) bucket.spend_cents += (row.cost_cents as number) ?? 0;
  }

  const points = Array.from(series.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({ points, period });
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit.**

```bash
git add api/admin/overview/revenue-spend-series.ts
git commit -m "feat(api): GET /api/admin/overview/revenue-spend-series"
```

---

### Task 9: Client fetchers for the 4 new endpoints

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Find the existing imports at the top of `src/lib/api.ts`.**

The first line is:
```typescript
import type { Property, Photo, Scene, PipelineLog, DailyStat, CostEvent, SceneRating, LearningData, PromptRevision } from './types';
```

- [ ] **Step 2: Extend the type imports.**

Replace that line with:

```typescript
import type {
  Property, Photo, Scene, PipelineLog, DailyStat, CostEvent, SceneRating, LearningData, PromptRevision,
  OverviewPeriod, OverviewSystemHealth, OverviewRecentListing, OverviewCostByProviderRow, OverviewRevenueSpendPoint,
} from './types';
```

- [ ] **Step 3: Add the four fetchers at the end of `src/lib/api.ts`.**

Append:

```typescript
// ─── Dashboard v3 Overview ─────────────────────────────────────────

export async function fetchOverviewSystemHealth(): Promise<OverviewSystemHealth> {
  return apiFetch(`/api/admin/overview/system-health`);
}

export async function fetchOverviewRecentListings(limit = 10): Promise<{ listings: OverviewRecentListing[] }> {
  const sp = new URLSearchParams({ limit: String(limit) });
  return apiFetch(`/api/admin/overview/recent-listings?${sp.toString()}`);
}

export async function fetchOverviewCostByProvider(period: OverviewPeriod = "30d"): Promise<{
  rows: OverviewCostByProviderRow[];
  total_cents: number;
  period: OverviewPeriod;
}> {
  const sp = new URLSearchParams({ period });
  return apiFetch(`/api/admin/overview/cost-by-provider?${sp.toString()}`);
}

export async function fetchOverviewRevenueSpendSeries(period: OverviewPeriod = "30d"): Promise<{
  points: OverviewRevenueSpendPoint[];
  period: OverviewPeriod;
}> {
  const sp = new URLSearchParams({ period });
  return apiFetch(`/api/admin/overview/revenue-spend-series?${sp.toString()}`);
}
```

- [ ] **Step 4: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/api.ts
git commit -m "feat(dashboard): client fetchers for the 4 Overview endpoints"
```

---

### Task 10: `KpiCard` component

**Files:**
- Create: `src/v2/components/dashboard/KpiCard.tsx`
- Test: `src/v2/components/dashboard/__tests__/KpiCard.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `src/v2/components/dashboard/__tests__/KpiCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "../KpiCard";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Active customers" value="142" gradient="blue" />);
    expect(screen.getByText("Active customers")).toBeTruthy();
    expect(screen.getByText("142")).toBeTruthy();
  });

  it("renders a positive delta with '+' prefix", () => {
    render(<KpiCard label="Revenue" value="$12.4k" gradient="navy" delta={15.2} />);
    expect(screen.getByText(/\+15\.2%/)).toBeTruthy();
  });

  it("renders a negative delta without doubled '-' prefix", () => {
    render(<KpiCard label="Spend" value="$8.1k" gradient="beige" delta={-3.4} deltaIsGoodWhenNegative />);
    expect(screen.getByText(/-3\.4%/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/KpiCard.test.tsx --run
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.**

Create `src/v2/components/dashboard/KpiCard.tsx`:

```tsx
import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

type GradientKey = "blue" | "navy" | "beige" | "status-healthy" | "status-degraded" | "status-critical";

const GRADIENT_VAR: Record<GradientKey, string> = {
  blue: "var(--le-gradient-blue)",
  navy: "var(--le-gradient-navy)",
  beige: "var(--le-gradient-beige)",
  "status-healthy": "var(--le-gradient-status-healthy)",
  "status-degraded": "var(--le-gradient-status-degraded)",
  "status-critical": "var(--le-gradient-status-critical)",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  gradient: GradientKey;
  icon?: ReactNode;
  delta?: number; // percentage, e.g. 15.2 or -3.4
  deltaIsGoodWhenNegative?: boolean;
  href?: string;
}

export function KpiCard({ label, value, gradient, icon, delta, deltaIsGoodWhenNegative = false, href }: KpiCardProps) {
  const showDelta = typeof delta === "number" && Number.isFinite(delta) && delta !== 0;
  const up = (delta ?? 0) > 0;
  const good = deltaIsGoodWhenNegative ? !up : up;
  const deltaColor = showDelta ? (good ? "text-[color:var(--le-success)]" : "text-[color:var(--le-danger)]") : "";
  const Icon = up ? TrendingUp : TrendingDown;

  const Inner = (
    <div
      className="flex h-[124px] flex-col justify-between rounded-[14px] border p-5"
      style={{
        background: "var(--le-bg-elev)",
        borderColor: "var(--le-border)",
        boxShadow: "var(--le-shadow-md)",
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-white"
          style={{ background: GRADIENT_VAR[gradient] }}
        >
          {icon}
        </div>
        <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div className="le-mono text-[28px] font-semibold tracking-tight" style={{ color: "var(--le-text)" }}>
          {value}
        </div>
        {showDelta && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
            <Icon className="h-3 w-3" strokeWidth={2} />
            {up ? "+" : ""}
            {delta!.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block transition-opacity hover:opacity-90">
        {Inner}
      </a>
    );
  }
  return Inner;
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/KpiCard.test.tsx --run
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/v2/components/dashboard/KpiCard.tsx src/v2/components/dashboard/__tests__/KpiCard.test.tsx
git commit -m "feat(dashboard): KpiCard component with gradient disc"
```

---

### Task 11: `PeriodSelector` component

**Files:**
- Create: `src/v2/components/dashboard/PeriodSelector.tsx`
- Test: `src/v2/components/dashboard/__tests__/PeriodSelector.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `src/v2/components/dashboard/__tests__/PeriodSelector.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PeriodSelector } from "../PeriodSelector";

describe("PeriodSelector", () => {
  it("renders the three options", () => {
    render(<PeriodSelector value="30d" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^7D$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^30D$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^90D$/i })).toBeTruthy();
  });

  it("marks the active option with aria-pressed=true", () => {
    render(<PeriodSelector value="7d" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^7D$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^30D$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onChange with the new period when clicked", () => {
    const onChange = vi.fn();
    render(<PeriodSelector value="30d" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^7D$/i }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/PeriodSelector.test.tsx --run
```
Expected: FAIL.

- [ ] **Step 3: Implement.**

Create `src/v2/components/dashboard/PeriodSelector.tsx`:

```tsx
import type { OverviewPeriod } from "@/lib/types";

const OPTIONS: Array<{ value: OverviewPeriod; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: OverviewPeriod;
  onChange: (v: OverviewPeriod) => void;
}) {
  return (
    <div
      className="inline-flex rounded-[10px] border p-1"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)" }}
      role="group"
      aria-label="Time period"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className="le-mono rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors"
            style={{
              background: active ? "var(--le-accent)" : "transparent",
              color: active ? "var(--le-accent-fg)" : "var(--le-text-muted)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/PeriodSelector.test.tsx --run
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/v2/components/dashboard/PeriodSelector.tsx src/v2/components/dashboard/__tests__/PeriodSelector.test.tsx
git commit -m "feat(dashboard): PeriodSelector segmented control"
```

---

### Task 12: `SidebarItem` primitive + `SidebarDropdown` primitive

**Files:**
- Create: `src/v2/components/dashboard/SidebarItem.tsx`
- Create: `src/v2/components/dashboard/SidebarDropdown.tsx`
- Test: `src/v2/components/dashboard/__tests__/SidebarItem.test.tsx`

- [ ] **Step 1: Write the failing test for SidebarItem.**

Create `src/v2/components/dashboard/__tests__/SidebarItem.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { SidebarItem } from "../SidebarItem";

const withRouter = (ui: React.ReactNode, path = "/dashboard") => (
  <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
);

describe("SidebarItem", () => {
  it("renders label and icon when expanded", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={false} />,
      ),
    );
    expect(screen.getByText("Overview")).toBeTruthy();
  });

  it("hides label when collapsed", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={true} />,
      ),
    );
    expect(screen.queryByText("Overview")).toBeNull();
  });

  it("marks active when the current path matches", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={false} end />,
        "/dashboard",
      ),
    );
    const link = screen.getByRole("link", { name: /Overview/i });
    expect(link.getAttribute("data-active")).toBe("true");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/SidebarItem.test.tsx --run
```
Expected: FAIL.

- [ ] **Step 3: Implement SidebarItem.**

Create `src/v2/components/dashboard/SidebarItem.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

export function SidebarItem({
  to,
  label,
  icon: Icon,
  collapsed,
  end = false,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group flex h-9 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-[color:var(--le-accent)] text-[color:var(--le-accent-fg)]"
            : "text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)] hover:text-[color:var(--le-text)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className="h-4 w-4 flex-none"
            strokeWidth={1.6}
            data-active={isActive ? "true" : "false"}
          />
          {!collapsed && <span className="truncate" data-active={isActive ? "true" : "false"}>{label}</span>}
        </>
      )}
    </NavLink>
  );
}
```

Note: `data-active` is read by the test.

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/SidebarItem.test.tsx --run
```
Expected: 3/3 PASS. If the `data-active` test fails, NavLink doesn't expose `isActive` on the rendered DOM — adjust by reading `aria-current="page"` (which NavLink does add by default) and update the test accordingly.

- [ ] **Step 5: Implement SidebarDropdown (no test — wrapper around state).**

Create `src/v2/components/dashboard/SidebarDropdown.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";

export function SidebarDropdown({
  label,
  icon: Icon,
  pathPrefix,
  collapsed,
  children,
}: {
  label: string;
  icon: LucideIcon;
  pathPrefix: string; // e.g. "/dashboard/orders"
  collapsed: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(pathPrefix);
  const [open, setOpen] = useState(isActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? label : undefined}
        className={`group flex h-9 w-full items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "text-[color:var(--le-text)]"
            : "text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)] hover:text-[color:var(--le-text)]"
        }`}
        aria-expanded={open}
      >
        <Icon className="h-4 w-4 flex-none" strokeWidth={1.6} />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            <ChevronRight
              className="h-3.5 w-3.5 transition-transform"
              strokeWidth={1.6}
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
          </>
        )}
      </button>
      {!collapsed && open && <div className="ml-7 mt-1 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Commit.**

```bash
git add src/v2/components/dashboard/SidebarItem.tsx src/v2/components/dashboard/SidebarDropdown.tsx src/v2/components/dashboard/__tests__/SidebarItem.test.tsx
git commit -m "feat(dashboard): SidebarItem + SidebarDropdown primitives"
```

---

### Task 13: `Sidebar` component (full nav tree)

**Files:**
- Create: `src/v2/components/dashboard/Sidebar.tsx`

- [ ] **Step 1: Implement Sidebar with the locked IA.**

Create `src/v2/components/dashboard/Sidebar.tsx`:

```tsx
import { useState, useEffect } from "react";
import {
  LayoutGrid, Package, Users, Building2, DollarSign, Wrench, Code2,
  GitBranch, ListChecks, ChevronLeft, Beaker, BookOpen, MapPin, Activity, Newspaper,
} from "lucide-react";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { useTheme } from "@/lib/theme";
import { SidebarItem } from "./SidebarItem";
import { SidebarDropdown } from "./SidebarDropdown";

const COLLAPSED_KEY = "le.dashboard.sidebarCollapsed";

export function Sidebar() {
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      className="flex h-screen flex-col border-r"
      style={{
        width: collapsed ? 64 : 240,
        background: "var(--le-bg)",
        borderColor: "var(--le-border)",
        transition: "width 200ms ease",
      }}
    >
      <div className="flex h-14 items-center px-4">
        <LELogoMark size={26} variant={theme === "dark" ? "light" : "dark"} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pt-2">
        <div className="flex flex-col gap-0.5">
          <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={collapsed} end />
          <SidebarDropdown label="Orders" icon={Package} pathPrefix="/dashboard/orders" collapsed={collapsed}>
            <SidebarItem to="/dashboard/orders/pipeline" label="Pipeline" icon={GitBranch} collapsed={collapsed} />
            <SidebarItem to="/dashboard/orders" label="Orders" icon={ListChecks} collapsed={collapsed} end />
          </SidebarDropdown>
          <SidebarItem to="/dashboard/users" label="Users" icon={Users} collapsed={collapsed} />
          <SidebarItem to="/dashboard/listings" label="Listings" icon={Building2} collapsed={collapsed} />
          <SidebarItem to="/dashboard/finances" label="Finances" icon={DollarSign} collapsed={collapsed} />
          <SidebarDropdown label="Tools" icon={Wrench} pathPrefix="/dashboard/tools" collapsed={collapsed}>
            <SidebarItem to="/dashboard/tools/blog" label="Blog" icon={Newspaper} collapsed={collapsed} />
          </SidebarDropdown>
          <SidebarDropdown label="Dev" icon={Code2} pathPrefix="/dashboard/dev" collapsed={collapsed}>
            <SidebarItem to="/dashboard/dev" label="Overview" icon={LayoutGrid} collapsed={collapsed} end />
            <SidebarItem to="/dashboard/dev/prompt-lab" label="Prompt Lab" icon={Beaker} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/recipes" label="Recipes" icon={BookOpen} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/knowledge-map" label="Knowledge Map" icon={MapPin} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/system-status" label="System Status" icon={Activity} collapsed={collapsed} />
          </SidebarDropdown>
        </div>
      </nav>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="m-2 flex h-8 items-center justify-center rounded-[8px] border text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)]"
        style={{ borderColor: "var(--le-border)" }}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronLeft
          className="h-4 w-4 transition-transform"
          strokeWidth={1.6}
          style={{ transform: collapsed ? "rotate(180deg)" : undefined }}
        />
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit.**

```bash
git add src/v2/components/dashboard/Sidebar.tsx
git commit -m "feat(dashboard): Sidebar with collapsible rail + locked IA"
```

---

### Task 14: `TopBar` component

**Files:**
- Create: `src/v2/components/dashboard/TopBar.tsx`

- [ ] **Step 1: Implement.**

Create `src/v2/components/dashboard/TopBar.tsx`:

```tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Upload as UploadIcon, User, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useAuth } from "@/lib/auth";

const PAGE_TITLES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/dashboard\/?$/, label: "Overview" },
  { pattern: /^\/dashboard\/orders\/pipeline/, label: "Pipeline" },
  { pattern: /^\/dashboard\/orders/, label: "Orders" },
  { pattern: /^\/dashboard\/users/, label: "Users" },
  { pattern: /^\/dashboard\/listings/, label: "Listings" },
  { pattern: /^\/dashboard\/finances/, label: "Finances" },
  { pattern: /^\/dashboard\/tools\/blog/, label: "Blog" },
  { pattern: /^\/dashboard\/dev\/prompt-lab/, label: "Prompt Lab" },
  { pattern: /^\/dashboard\/dev\/recipes/, label: "Recipes" },
  { pattern: /^\/dashboard\/dev\/knowledge-map/, label: "Knowledge Map" },
  { pattern: /^\/dashboard\/dev\/system-status/, label: "System Status" },
  { pattern: /^\/dashboard\/dev/, label: "Development" },
];

function resolveTitle(pathname: string): string {
  for (const { pattern, label } of PAGE_TITLES) {
    if (pattern.test(pathname)) return label;
  }
  return "Dashboard";
}

export function TopBar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const title = resolveTitle(location.pathname);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div
      className="flex h-14 items-center gap-4 border-b px-6"
      style={{
        background: "var(--le-bg)",
        borderColor: "var(--le-border)",
      }}
    >
      <h1 className="le-display text-[20px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-3">
        <Button asChild size="sm" variant="outline">
          <Link to="/upload">
            <UploadIcon className="mr-2 h-3.5 w-3.5" /> New video
          </Link>
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-[8px] border transition-colors hover:bg-[color:var(--le-bg-sunken)]"
              style={{ borderColor: "var(--le-border)" }}
              aria-label="Account menu"
            >
              <User className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-3 py-2 text-xs" style={{ color: "var(--le-text-muted)" }}>{user?.email}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account" className="cursor-pointer">
                <UserCircle className="mr-2 h-4 w-4" /> Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit.**

```bash
git add src/v2/components/dashboard/TopBar.tsx
git commit -m "feat(dashboard): TopBar with page title + theme + account menu"
```

---

### Task 15: `DashboardShell` (mounts Sidebar + TopBar + Outlet)

**Files:**
- Create: `src/v2/components/dashboard/DashboardShell.tsx`

- [ ] **Step 1: Implement.**

Create `src/v2/components/dashboard/DashboardShell.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import "@/v2/styles/v2.css";

export function DashboardShell() {
  return (
    <div
      className="le-root flex min-h-screen"
      style={{ background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Commit.**

```bash
git add src/v2/components/dashboard/DashboardShell.tsx
git commit -m "feat(dashboard): DashboardShell composing Sidebar + TopBar + Outlet"
```

---

### Task 16: Wire DashboardShell into routing behind the flag

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/components/TopNav.tsx`

- [ ] **Step 1: Update `src/pages/Dashboard.tsx`.**

Replace the entire file content with:

```tsx
import { Outlet } from "react-router-dom";
import { isDashboardV3Enabled } from "@/lib/featureFlags";
import { DashboardShell } from "@/v2/components/dashboard/DashboardShell";
import "@/v2/styles/v2.css";

/**
 * Dashboard shell.
 *
 * Behind VITE_LE_DASHBOARD_V3 flag:
 *   - ON  → renders the new vertical-sidebar DashboardShell.
 *   - OFF → renders the legacy max-w container (current behaviour).
 *
 * TopNav.tsx separately early-returns on /dashboard/* when the flag is ON,
 * so the new shell doesn't double-mount nav.
 */
const Dashboard = () => {
  if (isDashboardV3Enabled()) {
    return <DashboardShell />;
  }
  return (
    <div
      className="le-root"
      style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}
    >
      <main className="mx-auto w-full max-w-[1440px] px-8 py-12 md:px-12 md:py-16">
        <Outlet />
      </main>
    </div>
  );
};

export default Dashboard;
```

- [ ] **Step 2: Update `src/components/TopNav.tsx` to suppress on `/dashboard/*` when flag ON.**

Open `src/components/TopNav.tsx`. Find the early-return block (around line 144-151):

```typescript
  // v2 shell mounts its own navigation; suppress the legacy TopNav on /v2/*.
  if (location.pathname.startsWith("/v2")) return null;

  // Index.tsx renders its own hero-style navigation with auth modal hookup.
  if (location.pathname === "/") return null;

  // Login + auth callback render their own editorial branding.
  if (location.pathname === "/login" || location.pathname.startsWith("/auth")) return null;
```

Add the import at the top of the file (group with other lib imports):

```typescript
import { isDashboardV3Enabled } from "@/lib/featureFlags";
```

After the existing `pathname.startsWith("/v2")` early-return, add:

```typescript
  // Dashboard v3 shell mounts its own sidebar+topbar; suppress the legacy TopNav.
  if (isDashboardV3Enabled() && location.pathname.startsWith("/dashboard")) return null;
```

- [ ] **Step 3: Verify tsc + lint clean.**

```bash
pnpm tsc --noEmit
pnpm lint
```
Expected: both clean.

- [ ] **Step 4: Smoke-test that the flag toggles correctly.**

```bash
# Flag OFF (default in .env.example):
pnpm dev &
sleep 5
# Visit http://localhost:8080/dashboard in your browser — should look identical to current
# Now stop and set the flag:
kill %1
echo "VITE_LE_DASHBOARD_V3=true" >> .env.local
pnpm dev &
sleep 5
# Visit http://localhost:8080/dashboard — should now show the new sidebar + topbar
# (Overview page content is still the old one until Task 21.)
kill %1
```
Expected: Flag OFF → legacy layout. Flag ON → new sidebar + topbar, with the old Overview rendering inside the new content area.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/Dashboard.tsx src/components/TopNav.tsx
git commit -m "feat(dashboard): mount DashboardShell behind VITE_LE_DASHBOARD_V3"
```

---

### Task 17: `RevenueSpendChart` component

**Files:**
- Create: `src/v2/components/dashboard/RevenueSpendChart.tsx`
- Test: `src/v2/components/dashboard/__tests__/RevenueSpendChart.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `src/v2/components/dashboard/__tests__/RevenueSpendChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RevenueSpendChart } from "../RevenueSpendChart";

describe("RevenueSpendChart", () => {
  it("renders without crashing on an empty series", () => {
    const { container } = render(<RevenueSpendChart points={[]} loading={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a loading skeleton when loading", () => {
    const { getByText } = render(<RevenueSpendChart points={[]} loading={true} />);
    expect(getByText(/loading/i)).toBeTruthy();
  });

  it("shows revenue + spend totals in the header when given data", () => {
    const { getByText } = render(
      <RevenueSpendChart
        points={[
          { date: "2026-05-01", revenue_cents: 50000, spend_cents: 20000 },
          { date: "2026-05-02", revenue_cents: 70000, spend_cents: 30000 },
        ]}
        loading={false}
      />,
    );
    // total revenue = $1,200.00 ; total spend = $500.00
    expect(getByText(/\$1,200\.00/)).toBeTruthy();
    expect(getByText(/\$500\.00/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/RevenueSpendChart.test.tsx --run
```
Expected: FAIL.

- [ ] **Step 3: Implement.**

Create `src/v2/components/dashboard/RevenueSpendChart.tsx`:

```tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { OverviewRevenueSpendPoint } from "@/lib/types";

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

export function RevenueSpendChart({
  points,
  loading,
}: {
  points: OverviewRevenueSpendPoint[];
  loading: boolean;
}) {
  const totalRev = points.reduce((acc, p) => acc + p.revenue_cents, 0);
  const totalSpend = points.reduce((acc, p) => acc + p.spend_cents, 0);

  return (
    <div
      className="rounded-[14px] border p-6"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
    >
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Revenue & Spend</div>
          <div className="mt-1 flex gap-6">
            <div>
              <div className="le-mono text-2xl font-semibold" style={{ color: "var(--le-text)" }}>{formatUSD(totalRev)}</div>
              <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>Revenue</div>
            </div>
            <div>
              <div className="le-mono text-2xl font-semibold" style={{ color: "var(--le-text-muted)" }}>{formatUSD(totalSpend)}</div>
              <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>Spend</div>
            </div>
          </div>
        </div>
      </div>
      <div className="h-[260px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.13 240)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.62 0.13 240)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.85 0.04 80)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.85 0.04 80)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--le-border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11, fill: "var(--le-text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--le-text-muted)" }} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
              <Tooltip
                formatter={(value: number, name: string) => [formatUSD(value), name === "revenue_cents" ? "Revenue" : "Spend"]}
                labelFormatter={(d) => d}
              />
              <Area type="monotone" dataKey="revenue_cents" stroke="oklch(0.5 0.16 245)" strokeWidth={2} fill="url(#gradRev)" />
              <Area type="monotone" dataKey="spend_cents" stroke="oklch(0.78 0.05 75)" strokeWidth={2} fill="url(#gradSpend)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/RevenueSpendChart.test.tsx --run
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/v2/components/dashboard/RevenueSpendChart.tsx src/v2/components/dashboard/__tests__/RevenueSpendChart.test.tsx
git commit -m "feat(dashboard): RevenueSpendChart dual-area chart"
```

---

### Task 18: `CostProviderDonut` component

**Files:**
- Create: `src/v2/components/dashboard/CostProviderDonut.tsx`
- Test: `src/v2/components/dashboard/__tests__/CostProviderDonut.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `src/v2/components/dashboard/__tests__/CostProviderDonut.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CostProviderDonut } from "../CostProviderDonut";

describe("CostProviderDonut", () => {
  it("renders the total cents formatted as USD in the center", () => {
    const { getByText } = render(
      <CostProviderDonut
        rows={[
          { provider: "anthropic", cost_cents: 5000, pct: 50 },
          { provider: "kling-via-atlas", cost_cents: 5000, pct: 50 },
        ]}
        totalCents={10000}
        loading={false}
      />,
    );
    expect(getByText(/\$100\.00/)).toBeTruthy();
  });

  it("renders an empty state when no rows", () => {
    const { getByText } = render(
      <CostProviderDonut rows={[]} totalCents={0} loading={false} />,
    );
    expect(getByText(/no cost data/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/CostProviderDonut.test.tsx --run
```

- [ ] **Step 3: Implement.**

Create `src/v2/components/dashboard/CostProviderDonut.tsx`:

```tsx
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { OverviewCostByProviderRow } from "@/lib/types";

const COLOR_RAMP = [
  "oklch(0.6 0.13 240)",   // info-ish blue
  "oklch(0.62 0.15 155)",  // success green
  "oklch(0.72 0.14 75)",   // warn amber
  "oklch(0.58 0.17 25)",   // danger red
  "oklch(0.32 0.08 250)",  // navy
  "oklch(0.78 0.05 75)",   // beige
  "oklch(0.5 0.1 290)",    // violet
  "oklch(0.6 0.08 200)",   // teal
  "oklch(0.4 0.05 60)",    // bronze
];

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

export function CostProviderDonut({
  rows,
  totalCents,
  loading,
}: {
  rows: OverviewCostByProviderRow[];
  totalCents: number;
  loading: boolean;
}) {
  if (!loading && rows.length === 0) {
    return (
      <div
        className="flex h-full min-h-[340px] flex-col rounded-[14px] border p-6"
        style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
      >
        <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Cost by provider</div>
        <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--le-text-muted)" }}>
          No cost data in this period
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-[340px] flex-col rounded-[14px] border p-6"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
    >
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Cost by provider</div>
      <div className="relative mt-2 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="cost_cents"
              nameKey="provider"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={COLOR_RAMP[i % COLOR_RAMP.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name: string, p: { payload?: { provider: string; pct: number } }) => [
                `${formatUSD(value)} (${(p.payload?.pct ?? 0).toFixed(1)}%)`,
                p.payload?.provider ?? "",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="le-mono text-2xl font-semibold" style={{ color: "var(--le-text)" }}>{formatUSD(totalCents)}</div>
          <div className="le-eyebrow mt-1" style={{ color: "var(--le-text-muted)" }}>Total</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.slice(0, 6).map((r, i) => (
          <div key={r.provider} className="flex items-center gap-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: COLOR_RAMP[i % COLOR_RAMP.length] }} />
            <span>{r.provider}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/CostProviderDonut.test.tsx --run
```
Expected: 2/2 PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/v2/components/dashboard/CostProviderDonut.tsx src/v2/components/dashboard/__tests__/CostProviderDonut.test.tsx
git commit -m "feat(dashboard): CostProviderDonut chart"
```

---

### Task 19: `SystemHealthBadge` component

**Files:**
- Create: `src/v2/components/dashboard/SystemHealthBadge.tsx`

- [ ] **Step 1: Implement.**

Create `src/v2/components/dashboard/SystemHealthBadge.tsx`:

```tsx
import type { SystemHealthStatus } from "@/lib/types";

const STATUS_LABEL: Record<SystemHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
};

const STATUS_COLOR: Record<SystemHealthStatus, { bg: string; fg: string }> = {
  healthy: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  degraded: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  critical: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
};

export function SystemHealthBadge({ status }: { status: SystemHealthStatus }) {
  const { bg, fg } = STATUS_COLOR[status];
  return (
    <span
      className="le-mono inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
      style={{ background: bg, color: fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: fg }} />
      {STATUS_LABEL[status]}
    </span>
  );
}
```

- [ ] **Step 2: Verify tsc clean and commit.**

```bash
pnpm tsc --noEmit
git add src/v2/components/dashboard/SystemHealthBadge.tsx
git commit -m "feat(dashboard): SystemHealthBadge status pill"
```

---

### Task 20: `RecentListingsTable` component

**Files:**
- Create: `src/v2/components/dashboard/RecentListingsTable.tsx`
- Test: `src/v2/components/dashboard/__tests__/RecentListingsTable.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `src/v2/components/dashboard/__tests__/RecentListingsTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecentListingsTable } from "../RecentListingsTable";

const SAMPLE = [
  {
    id: "p-1",
    order_id: "V1-00001",
    address: "123 Main St, Punta Gorda FL",
    customer_id: "u-1",
    customer_email: "agent@example.com",
    status: "complete",
    cost_cents: 12350,
    created_at: "2026-05-13T12:00:00Z",
    thumbnail_url: null,
  },
];

describe("RecentListingsTable", () => {
  it("renders rows with order id, customer, and cost", () => {
    render(
      <MemoryRouter>
        <RecentListingsTable listings={SAMPLE} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("V1-00001")).toBeTruthy();
    expect(screen.getByText("agent@example.com")).toBeTruthy();
    expect(screen.getByText(/\$123\.50/)).toBeTruthy();
  });

  it("renders empty state when no listings", () => {
    render(
      <MemoryRouter>
        <RecentListingsTable listings={[]} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no recent listings/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm test src/v2/components/dashboard/__tests__/RecentListingsTable.test.tsx --run
```

- [ ] **Step 3: Implement.**

Create `src/v2/components/dashboard/RecentListingsTable.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { OverviewRecentListing } from "@/lib/types";

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  complete: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  needs_review: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  failed: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
};

function StatusPill({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: "var(--le-bg-sunken)", fg: "var(--le-text-muted)" };
  return (
    <span
      className="le-mono inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function RecentListingsTable({
  listings,
  loading,
}: {
  listings: OverviewRecentListing[];
  loading: boolean;
}) {
  return (
    <div
      className="rounded-[14px] border"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
    >
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--le-border)" }}>
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Recent listings</div>
        </div>
        <Link to="/dashboard/listings" className="le-mono text-xs font-medium" style={{ color: "var(--le-text-muted)" }}>
          View all →
        </Link>
      </div>
      {loading ? (
        <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
      ) : listings.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No recent listings.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--le-text-muted)" }}>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Order</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Customer</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Address</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Stage</th>
              <th className="le-eyebrow px-6 py-3 text-right font-medium">Cost</th>
              <th className="le-eyebrow px-6 py-3 text-right font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="border-t" style={{ borderColor: "var(--le-border)" }}>
                <td className="px-6 py-3">
                  <Link to={`/dashboard/listings/${l.id}`} className="le-mono text-xs font-semibold" style={{ color: "var(--le-text)" }}>
                    {l.order_id ?? l.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-6 py-3" style={{ color: "var(--le-text-muted)" }}>{l.customer_email ?? "—"}</td>
                <td className="px-6 py-3" style={{ color: "var(--le-text)" }}>{l.address}</td>
                <td className="px-6 py-3"><StatusPill status={l.status} /></td>
                <td className="le-mono px-6 py-3 text-right" style={{ color: "var(--le-text)" }}>{formatUSD(l.cost_cents)}</td>
                <td className="px-6 py-3 text-right text-xs" style={{ color: "var(--le-text-muted)" }}>{formatRelative(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

```bash
pnpm test src/v2/components/dashboard/__tests__/RecentListingsTable.test.tsx --run
```
Expected: 2/2 PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/v2/components/dashboard/RecentListingsTable.tsx src/v2/components/dashboard/__tests__/RecentListingsTable.test.tsx
git commit -m "feat(dashboard): RecentListingsTable with status pills"
```

---

### Task 21: Rewrite `Overview.tsx`

**Files:**
- Modify: `src/pages/dashboard/Overview.tsx`

- [ ] **Step 1: Back up the legacy Overview content (already in git history; this is just a safety pause).**

```bash
git log --oneline -- src/pages/dashboard/Overview.tsx | head -5
```
Expected: at least one commit shown. If not, stop — the file may be unstaged elsewhere.

- [ ] **Step 2: Replace `src/pages/dashboard/Overview.tsx` with the v3 implementation.**

Replace the entire file content with:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Film, Percent, Activity } from "lucide-react";
import {
  fetchOverviewSystemHealth,
  fetchOverviewRecentListings,
  fetchOverviewCostByProvider,
  fetchOverviewRevenueSpendSeries,
  fetchProperties,
} from "@/lib/api";
import { listRevenueEntries } from "@/lib/finances";
import { KpiCard } from "@/v2/components/dashboard/KpiCard";
import { PeriodSelector } from "@/v2/components/dashboard/PeriodSelector";
import { RevenueSpendChart } from "@/v2/components/dashboard/RevenueSpendChart";
import { CostProviderDonut } from "@/v2/components/dashboard/CostProviderDonut";
import { RecentListingsTable } from "@/v2/components/dashboard/RecentListingsTable";
import { SystemHealthBadge } from "@/v2/components/dashboard/SystemHealthBadge";
import type { OverviewPeriod } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import "@/v2/styles/v2.css";

function periodMs(period: OverviewPeriod): number {
  return { "7d": 7, "30d": 30, "90d": 90 }[period] * 86_400_000;
}

const Overview = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<OverviewPeriod>("30d");
  const since = new Date(Date.now() - periodMs(period)).toISOString();

  const health = useQuery({
    queryKey: ["overview", "system-health"],
    queryFn: fetchOverviewSystemHealth,
    refetchInterval: 60_000,
  });

  const recent = useQuery({
    queryKey: ["overview", "recent-listings"],
    queryFn: () => fetchOverviewRecentListings(10),
  });

  const cost = useQuery({
    queryKey: ["overview", "cost-by-provider", period],
    queryFn: () => fetchOverviewCostByProvider(period),
  });

  const series = useQuery({
    queryKey: ["overview", "revenue-spend-series", period],
    queryFn: () => fetchOverviewRevenueSpendSeries(period),
  });

  // Customer count (active in period) — count distinct user_id from properties created in period.
  const activeCustomers = useQuery({
    queryKey: ["overview", "active-customers", period],
    queryFn: async () => {
      const { properties } = await fetchProperties({ limit: 500 });
      const sincePropMs = Date.now() - periodMs(period);
      const recent = properties.filter((p) => new Date(p.created_at).getTime() >= sincePropMs);
      const users = new Set(recent.map((p) => (p as Property & { user_id?: string }).user_id).filter(Boolean) as string[]);
      return users.size;
    },
  });

  // Videos delivered (period) — count of properties moved to complete with completed_at >= since
  const delivered = useQuery({
    queryKey: ["overview", "delivered", period],
    queryFn: async () => {
      const { properties } = await fetchProperties({ status: "complete", limit: 500 });
      const sinceMs = Date.now() - periodMs(period);
      return properties.filter((p) => {
        const completedAt = (p as Property & { completed_at?: string }).completed_at;
        return completedAt ? new Date(completedAt).getTime() >= sinceMs : false;
      }).length;
    },
  });

  // Margin % — (revenue - spend) / revenue from current period series. Falls back to 0.
  const margin = (() => {
    const points = series.data?.points ?? [];
    const rev = points.reduce((acc, p) => acc + p.revenue_cents, 0);
    const sp = points.reduce((acc, p) => acc + p.spend_cents, 0);
    if (rev === 0) return null;
    return ((rev - sp) / rev) * 100;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Welcome back</div>
          <h2 className="le-display mt-1 text-[28px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
            {user?.email?.split("@")[0] ?? "Admin"}
          </h2>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`Active customers (${period})`}
          value={activeCustomers.isLoading ? "…" : String(activeCustomers.data ?? 0)}
          gradient="blue"
          icon={<Users className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label={`Videos delivered (${period})`}
          value={delivered.isLoading ? "…" : String(delivered.data ?? 0)}
          gradient="navy"
          icon={<Film className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label={`Margin (${period})`}
          value={margin === null ? "—" : `${margin.toFixed(1)}%`}
          gradient="beige"
          icon={<Percent className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label="System health"
          value={
            health.isLoading ? (
              "…"
            ) : (
              <div className="flex flex-col gap-1">
                <SystemHealthBadge status={health.data?.status ?? "healthy"} />
                <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                  {health.data?.alert_count ?? 0} alerts
                </span>
              </div>
            )
          }
          gradient={
            health.data?.status === "critical"
              ? "status-critical"
              : health.data?.status === "degraded"
              ? "status-degraded"
              : "status-healthy"
          }
          icon={<Activity className="h-5 w-5" strokeWidth={1.6} />}
          href="/dashboard/dev/system-status"
        />
      </div>

      {/* Chart + donut row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueSpendChart points={series.data?.points ?? []} loading={series.isLoading} />
        </div>
        <CostProviderDonut
          rows={cost.data?.rows ?? []}
          totalCents={cost.data?.total_cents ?? 0}
          loading={cost.isLoading}
        />
      </div>

      {/* Recent listings */}
      <RecentListingsTable listings={recent.data?.listings ?? []} loading={recent.isLoading} />
    </div>
  );
};

export default Overview;
```

- [ ] **Step 3: Add the missing `Property` type import at the top of the file.**

Find line 1 and replace the import block as needed. The compiler will tell you what's missing — most likely you need to add `Property` to the `@/lib/types` import:

```typescript
import type { OverviewPeriod, Property } from "@/lib/types";
```

- [ ] **Step 4: Verify tsc clean.**

```bash
pnpm tsc --noEmit
```
Expected: clean. Fix any reported errors.

- [ ] **Step 5: Run the full test suite.**

```bash
pnpm test --run
```
Expected: green.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/dashboard/Overview.tsx
git commit -m "feat(dashboard): rewrite Overview using v3 components"
```

---

### Task 22: Manual visual smoke-test

**Files:** none.

- [ ] **Step 1: Set the flag locally.**

```bash
# Ensure .env.local has the flag ON (Task 16 already wrote it):
grep VITE_LE_DASHBOARD_V3 .env.local
```
Expected: `VITE_LE_DASHBOARD_V3=true`. If missing, append it.

- [ ] **Step 2: Start the dev server and visit `/dashboard`.**

```bash
pnpm dev
```
Open `http://localhost:8080/dashboard` in a browser. Confirm visually:
- Sidebar renders on the left with the locked IA (Overview / Orders / Users / Listings / Finances / Tools / Dev).
- Top bar shows "Overview" as the page title.
- Four KPI cards in a row with gradient discs.
- Revenue+Spend dual-area chart fills 2/3 of the second row, donut fills 1/3.
- Recent listings table at the bottom.
- Sidebar collapses on `cmd+\` and reopens; state persists across a page refresh.
- Period selector 7D / 30D / 90D switches the chart + donut data.
- Theme toggle in the top bar flips between light and dark; gradients remain readable.

- [ ] **Step 3: Open the network tab and verify the 4 new endpoints fire.**

In DevTools → Network, look for:
- `/api/admin/overview/system-health`
- `/api/admin/overview/recent-listings?limit=10`
- `/api/admin/overview/cost-by-provider?period=30d`
- `/api/admin/overview/revenue-spend-series?period=30d`

Expected: all return 200 with JSON matching the spec. If any return 500, open Vercel function logs (`pnpm dev` console).

- [ ] **Step 4: Flip the flag back to false and confirm legacy behaviour.**

Edit `.env.local`:
```
VITE_LE_DASHBOARD_V3=false
```
Restart `pnpm dev`. Visit `/dashboard`. Expected: old TopNav + old Overview render — identical to pre-PR state.

- [ ] **Step 5: Re-enable the flag for the rest of the work.**

```bash
sed -i '' 's/VITE_LE_DASHBOARD_V3=false/VITE_LE_DASHBOARD_V3=true/' .env.local
```

- [ ] **Step 6: No commit needed for this task (no code changes). Continue to Task 23.**

---

### Task 23: Final type-check, lint, test, and HANDOFF update

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Full check.**

```bash
pnpm tsc --noEmit
pnpm lint
pnpm test --run
```
Expected: all clean.

- [ ] **Step 2: Update HANDOFF per LE convention.**

Open `docs/HANDOFF.md`. Find the "Right now" section at the top. Add a new block above it (do not delete existing content):

```markdown
**2026-05-13 (later): Dashboard redesign Stage 1 — shell + Overview on `feat/dashboard-redesign-stage-1` (off `dev`).** New `DashboardShell` (vertical sidebar + slim top bar) + rewritten Overview page (4 KPI cards · revenue/spend dual-area chart · cost-by-provider donut · recent listings table) + 4 new admin Overview API endpoints. Behind `VITE_LE_DASHBOARD_V3` flag — OFF by default. Spec [`specs/2026-05-13-admin-dashboard-redesign-design.md`](./specs/2026-05-13-admin-dashboard-redesign-design.md). Plan [`plans/2026-05-13-dashboard-redesign-stage-1-plan.md`](./plans/2026-05-13-dashboard-redesign-stage-1-plan.md). tsc + lint + vitest clean. **Awaiting Oliver smoke-test on dev before flag-flip + merge.**
```

- [ ] **Step 3: Commit.**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): dashboard redesign stage-1 entry"
```

- [ ] **Step 4: Push the branch (only after Oliver explicit go).**

```bash
# WAIT for Oliver to explicitly approve push. Do not push without permission.
# When approved:
git push -u origin feat/dashboard-redesign-stage-1
```

- [ ] **Step 5: Open a PR (only after push).**

```bash
gh pr create --base dev --title "Dashboard redesign — Stage 1 (shell + Overview)" --body "$(cat <<'EOF'
## Summary
- New DashboardShell (vertical sidebar + slim top bar) behind VITE_LE_DASHBOARD_V3 flag
- Rewritten Overview page: 4 KPI cards, revenue/spend dual-area chart, cost-by-provider donut, recent listings table
- 4 new admin API endpoints: /api/admin/overview/{system-health,recent-listings,cost-by-provider,revenue-spend-series}
- Spec: docs/specs/2026-05-13-admin-dashboard-redesign-design.md
- Plan: docs/plans/2026-05-13-dashboard-redesign-stage-1-plan.md

## Test plan
- [ ] tsc --noEmit clean
- [ ] pnpm lint clean
- [ ] pnpm test --run green
- [ ] Manual: VITE_LE_DASHBOARD_V3=true → new shell + Overview render at /dashboard
- [ ] Manual: VITE_LE_DASHBOARD_V3=false (default) → legacy dashboard renders unchanged
- [ ] Manual: 4 endpoints return 200 with expected shapes
- [ ] Manual: theme toggle + sidebar collapse + period selector all work
EOF
)"
```

---

## Self-Review

### Spec coverage check

| Spec section | Implementing task(s) |
|---|---|
| 1. Goal | Stage 1 plan as a whole |
| 2. IA — sidebar tree | Task 13 (Sidebar) |
| 3. Visual system — tokens | Task 3 (gradient tokens) |
| 3. Visual system — components | Tasks 10 (KpiCard), 11 (PeriodSelector), 17 (chart), 18 (donut), 19 (badge), 20 (table) |
| 4. Shell layout | Tasks 13 (Sidebar), 14 (TopBar), 15 (DashboardShell), 16 (wire-up) |
| 5. Overview structure | Task 21 (Overview rewrite) |
| 5. KPI specs | Tasks 5, 10, 19, 21 |
| 5. Charts | Tasks 7, 8 (APIs); 17, 18 (components); 21 (composition) |
| 5. Recent listings table | Tasks 6 (API), 20 (component), 21 (composition) |
| 6. Per-page treatment (Pipeline/Listings/Finances/Dev/Tools/Users/Orders) | OUT OF SCOPE — Stages 2-5 |
| 7. Routes/redirects | OUT OF SCOPE — Stages 2-5 |
| 8. Stage 1 deliverable | Tasks 1-23 |
| 9. API surface | Tasks 5, 6, 7, 8 (4 endpoints); Tasks 9 (client fetchers) |
| 10. Migrations | N/A — Stage 1 has none |
| 11. Risks | Acknowledged in Definition of Done (visual smoke required) |
| 12. Out of scope | Explicitly excluded |

### Placeholder scan

Searched for: `TBD`, `TODO`, `fill in`, `add appropriate`, `similar to`, `etc`. None remain in plan body.

### Type consistency check

- `OverviewPeriod` defined Task 4, used Tasks 7, 8, 9, 11, 21 — consistent.
- `OverviewSystemHealth` defined Task 4, returned Task 5, consumed Task 21 — consistent.
- `OverviewRecentListing` defined Task 4, returned Task 6, consumed Tasks 20, 21 — consistent.
- `OverviewCostByProviderRow` defined Task 4, returned Task 7, consumed Tasks 18, 21 — consistent.
- `OverviewRevenueSpendPoint` defined Task 4, returned Task 8, consumed Tasks 17, 21 — consistent.
- `KpiCard` gradient prop values (`"blue" | "navy" | "beige" | "status-healthy" | "status-degraded" | "status-critical"`) defined Task 10, used Task 21 — consistent.
- `SystemHealthBadge` status prop matches `SystemHealthStatus` from Task 4 — consistent.

All clear.

---

## Next Stage

After Stage 1 merges to `main`, write the Stage 2 plan: Listings rename + redirects. Spec section 6.4 + 7. Reference this plan's `DashboardShell` and component conventions.
