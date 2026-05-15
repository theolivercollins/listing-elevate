# Homepage Ally — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ally — Listing Elevate's AI concierge — to the public homepage as a floating chat widget that answers product questions, qualifies leads, and routes high-intent visitors to sign-up. Brand-neutral, agent-agnostic, never mentions Helgemo Team.

**Architecture:** Lift & adapt — copy in-app blog Ally components/endpoint to a new `marketing/` namespace, scrub Helgemo persona, swap form-patching for lead capture, add per-IP rate limiting and curated knowledge injection. Single Supabase table doubles as transient thread store. Cost-tracked through existing `cost_events` ledger.

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind, Vercel Serverless (Node 20 ESM), Supabase Postgres, Anthropic Claude Sonnet 4.6 with prompt caching, framer-motion, Vitest.

**Spec:** [`docs/specs/2026-05-15-homepage-ally-design.md`](../specs/2026-05-15-homepage-ally-design.md)

---

## Pre-flight (do once before starting)

- Confirm worktree branch: `git status -sb` shows `worktree-feat+homepage-ally`.
- Confirm origin/main has the blog Ally code: `ls src/components/blog/AllyFloatingChat.tsx api/blog/ai/chat.ts` returns both files.
- Run baseline tests: `pnpm test` passes (locks in the "before" state).
- Skim spec sections §2 (hard rules), §4.1–4.2 (persona), §5 (visual). The plan assumes you've read these.

---

## File map

| Path | Status | Responsibility |
|---|---|---|
| `supabase/migrations/056_marketing_ally.sql` | NEW | `marketing_leads` + `marketing_chat_rate_limits` tables |
| `lib/cost.ts` | NEW | Generic `recordCost()` — moved up from `lib/blog-engine/cost.ts` |
| `lib/blog-engine/cost.ts` | MODIFY | Re-export `recordCost` from new path; keep `recordBlogCost` thin wrapper |
| `lib/marketing/cookie.ts` | NEW | `getOrSetConversationCookie(req, res)` — anonymous conversation_id |
| `lib/marketing/rate-limit.ts` | NEW | `assertRateLimit(ipHash, conversationId)` — 4 buckets via Supabase |
| `lib/marketing/hash-ip.ts` | NEW | `hashIp(req)` — sha256(ip + IP_HASH_SALT), never raw IP |
| `lib/marketing/knowledge.md` | NEW | Curated product knowledge (~2KB markdown) |
| `lib/marketing/build-knowledge.ts` | NEW | Build-time extractor: Pricing.tsx + FAQ.tsx → JSON |
| `lib/marketing/pricing.json` | GENERATED | Built artifact, gitignored |
| `lib/marketing/faq.json` | GENERATED | Built artifact, gitignored |
| `src/v2/components/landing/Pricing.tsx` | MODIFY | Extract `export const PRICING_TIERS` (no behavior change) |
| `src/v2/components/landing/FAQ.tsx` | MODIFY | Extract `export const FAQ_ITEMS` (no behavior change) |
| `api/marketing/ally-chat.ts` | NEW | POST endpoint — Anthropic call, schema parse, lead upsert, cost record |
| `api/cron/marketing-ally-cleanup.ts` | NEW | Daily janitor — purges stale rate-limit + abandoned threads |
| `src/components/marketing/AllyAvatar.tsx` | NEW | Inline-SVG illustrated mark, 32×32 |
| `src/components/marketing/AllyChip.tsx` | NEW | Quick-reply / suggested-reply pill |
| `src/components/marketing/AllyCTACard.tsx` | NEW | "Get started" expanded CTA card |
| `src/components/marketing/MarketingAllyChat.tsx` | NEW | Floating widget — lifted from `AllyFloatingChat.tsx` |
| `src/lib/marketing/api-client.ts` | NEW | Frontend `marketingAllyChat()` fetch wrapper + types |
| `src/v2/components/landing/V2Landing.tsx` | MODIFY | Mount `<MarketingAllyChat />` behind `VITE_HOMEPAGE_ALLY_ENABLED` flag |
| `vercel.json` | MODIFY | Register `/api/cron/marketing-ally-cleanup` daily cron |
| `package.json` | MODIFY | Add `prebuild` script: `tsx lib/marketing/build-knowledge.ts` |
| `.gitignore` | MODIFY | Ignore `lib/marketing/pricing.json` + `faq.json` |
| `scripts/marketing/test-ally-chat.ts` | NEW | End-to-end smoke — 5 canned conversational scenarios |
| `docs/HANDOFF.md` | MODIFY | Add "Right now" entry for homepage Ally |

---

## Midpoint checkpoint

After **Task 8**, the backend is curl-testable end-to-end without any UI work. Stop and verify before starting UI tasks. Spec §10.2 has the smoke scenarios.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/056_marketing_ally.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/056_marketing_ally.sql
-- Homepage Ally — public concierge chat tables.
-- See docs/specs/2026-05-15-homepage-ally-design.md §6 for full data model.

-- 1. marketing_leads — also doubles as the transient thread store.
create table marketing_leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  email text,
  name text,
  phone text,
  role text,
  intent text,
  conversation jsonb not null default '[]'::jsonb,
  source_url text,
  ip_hash text,
  user_agent text,
  utm jsonb,
  total_messages int not null default 0,
  total_cost_cents int not null default 0,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_leads_email_idx on marketing_leads (email) where email is not null;
create index marketing_leads_created_idx on marketing_leads (created_at desc);
create index marketing_leads_status_idx on marketing_leads (status);
create index marketing_leads_updated_idx on marketing_leads (updated_at);

alter table marketing_leads enable row level security;
-- No policies → only service-role API access.

-- 2. marketing_chat_rate_limits — token-bucket rows for per-IP & per-session caps.
create table marketing_chat_rate_limits (
  bucket_key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now(),
  expires_at timestamptz not null
);

create index marketing_chat_rate_limits_expires_idx on marketing_chat_rate_limits (expires_at);

alter table marketing_chat_rate_limits enable row level security;
-- No policies → only service-role API access.

-- 3. updated_at trigger for marketing_leads
create or replace function marketing_leads_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger marketing_leads_set_updated_at_trg
before update on marketing_leads
for each row execute function marketing_leads_set_updated_at();
```

- [ ] **Step 2: Verify it lints & looks consistent**

Run: `head -3 supabase/migrations/056_marketing_ally.sql`
Expected: First three lines match the comment header above.

- [ ] **Step 3: DO NOT apply yet**

The migration applies to the shared prod Supabase (per `CLAUDE.md` branch model). It will be applied via Supabase MCP `apply_migration` after **explicit user permission** in Task 16. For now, it's just on disk.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/056_marketing_ally.sql
git commit -m "feat(marketing): migration 056 — marketing_leads + rate_limits tables"
```

---

## Task 2: Generalize cost recorder

**Files:**
- Create: `lib/cost.ts`
- Modify: `lib/blog-engine/cost.ts`
- Test: existing `lib/blog-engine/cost.test.ts` must still pass unchanged.

- [ ] **Step 1: Read the existing file**

Run: `cat lib/blog-engine/cost.ts`
Note: Returns the `BlogCostStage`/`BlogCostInput`/`recordBlogCost` definitions. The plan below assumes the structure shown there.

- [ ] **Step 2: Create the generic `lib/cost.ts`**

```typescript
// lib/cost.ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * cost_events.stage values used across the codebase.
 * Add new values here as features land — this is just for type safety;
 * the DB column is unconstrained text.
 */
export type CostStage =
  // Blog engine (see lib/blog-engine/cost.ts for the originals)
  | "blog_research"
  | "blog_topic_distill"
  | "blog_draft"
  | "blog_regen"
  | "blog_rewrite"
  | "blog_image_tag"
  | "blog_correction_distill"
  | "blog_publish_browser"
  | "blog_ai_draft"
  // Homepage Ally
  | "marketing_chat";

export interface CostInput {
  stage: CostStage;
  cost_cents: number;
  provider: string;
  /** Free-form context written to `cost_events.metadata` (jsonb). */
  metadata?: Record<string, unknown>;
  /** Optional FK to blog_posts.id; null for non-blog stages. */
  post_id?: string | null;
  /** Optional FK to blog_sites.id; null for non-blog stages. */
  site_id?: string | null;
}

export async function recordCost(
  supabase: SupabaseClient,
  input: CostInput,
): Promise<void> {
  const { error } = await supabase.from("cost_events").insert([{
    stage: input.stage,
    cost_cents: input.cost_cents,
    provider: input.provider,
    post_id: input.post_id ?? null,
    site_id: input.site_id ?? null,
    metadata: input.metadata ?? {},
  }]);
  if (error) throw new Error(`recordCost failed: ${error.message}`);
}
```

- [ ] **Step 3: Refactor `lib/blog-engine/cost.ts` to delegate**

Replace the body of `recordBlogCost` to call `recordCost`. Keep the `BlogCostStage` and `BlogCostInput` types as before so callers don't need updating.

```typescript
// lib/blog-engine/cost.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCost, type CostStage } from "../cost.js";

export type BlogCostStage = Extract<CostStage,
  | "blog_research"
  | "blog_topic_distill"
  | "blog_draft"
  | "blog_regen"
  | "blog_rewrite"
  | "blog_image_tag"
  | "blog_correction_distill"
  | "blog_publish_browser"
  | "blog_ai_draft"
>;

export interface BlogCostInput {
  stage: BlogCostStage;
  cost_cents: number;
  post_id: string | null;
  site_id: string;
  provider: string;
  metadata?: Record<string, unknown>;
}

export async function recordBlogCost(
  supabase: SupabaseClient,
  input: BlogCostInput,
): Promise<void> {
  await recordCost(supabase, {
    stage: input.stage,
    cost_cents: input.cost_cents,
    provider: input.provider,
    post_id: input.post_id,
    site_id: input.site_id,
    metadata: input.metadata,
  });
}
```

- [ ] **Step 4: Run existing blog cost tests**

Run: `pnpm vitest run lib/blog-engine/cost.test.ts`
Expected: PASS — the public API of `recordBlogCost` is unchanged.

- [ ] **Step 5: Type-check the whole repo**

Run: `pnpm tsc -p tsconfig.api.json --noEmit && pnpm tsc -p tsconfig.app.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add lib/cost.ts lib/blog-engine/cost.ts
git commit -m "refactor(cost): extract recordCost to lib/cost.ts; recordBlogCost delegates"
```

---

## Task 3: IP hash helper

**Files:**
- Create: `lib/marketing/hash-ip.ts`
- Test: `lib/marketing/hash-ip.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/marketing/hash-ip.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hashIp } from "./hash-ip";

describe("hashIp", () => {
  const ORIGINAL_SALT = process.env.IP_HASH_SALT;

  beforeEach(() => {
    process.env.IP_HASH_SALT = "test-salt-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_SALT === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = ORIGINAL_SALT;
  });

  it("returns a deterministic 64-char hex string for the same IP", () => {
    const a = hashIp("203.0.113.42");
    const b = hashIp("203.0.113.42");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different IPs", () => {
    expect(hashIp("203.0.113.1")).not.toBe(hashIp("203.0.113.2"));
  });

  it("prefers the first IP from x-forwarded-for", () => {
    const fromHeader = hashIp({ headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" } } as any);
    const direct = hashIp("203.0.113.42");
    expect(fromHeader).toBe(direct);
  });

  it("falls back to a stable 'unknown' hash when no IP is resolvable", () => {
    const unknown = hashIp({ headers: {} } as any);
    expect(unknown).toMatch(/^[0-9a-f]{64}$/);
    expect(unknown).toBe(hashIp({ headers: {} } as any));
  });

  it("throws if IP_HASH_SALT is missing", () => {
    delete process.env.IP_HASH_SALT;
    expect(() => hashIp("203.0.113.42")).toThrow(/IP_HASH_SALT/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run lib/marketing/hash-ip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/marketing/hash-ip.ts
import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

/**
 * Returns sha256(ip + IP_HASH_SALT) as 64-char hex.
 * Accepts a raw IP string OR a VercelRequest (in which case it pulls from
 * x-forwarded-for first, falling back to req.socket.remoteAddress).
 * Never returns the raw IP — this is the only value we persist.
 */
export function hashIp(input: string | VercelRequest): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT env var is required");

  let ip: string;
  if (typeof input === "string") {
    ip = input;
  } else {
    const xff = input.headers?.["x-forwarded-for"];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    ip = xffStr?.split(",")[0]?.trim()
      || (input as any).socket?.remoteAddress
      || "unknown";
  }

  return createHash("sha256").update(ip + salt).digest("hex");
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm vitest run lib/marketing/hash-ip.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/marketing/hash-ip.ts lib/marketing/hash-ip.test.ts
git commit -m "feat(marketing): IP hash helper with required IP_HASH_SALT"
```

---

## Task 4: Cookie helper

**Files:**
- Create: `lib/marketing/cookie.ts`
- Test: `lib/marketing/cookie.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/marketing/cookie.test.ts
import { describe, it, expect } from "vitest";
import { getOrSetConversationCookie } from "./cookie";

const COOKIE_NAME = "mally_cid";

function mockReqRes(cookieHeader?: string) {
  const setHeaders: Record<string, string | string[]> = {};
  const req: any = { headers: cookieHeader ? { cookie: cookieHeader } : {} };
  const res: any = {
    setHeader: (k: string, v: string | string[]) => { setHeaders[k.toLowerCase()] = v; },
  };
  return { req, res, setHeaders };
}

describe("getOrSetConversationCookie", () => {
  it("returns existing valid uuid when cookie present", () => {
    const existing = "11111111-1111-4111-8111-111111111111";
    const { req, res, setHeaders } = mockReqRes(`other=foo; ${COOKIE_NAME}=${existing}; bar=baz`);
    const id = getOrSetConversationCookie(req, res);
    expect(id).toBe(existing);
    expect(setHeaders["set-cookie"]).toBeUndefined();
  });

  it("issues a new uuid + Set-Cookie header when no cookie present", () => {
    const { req, res, setHeaders } = mockReqRes();
    const id = getOrSetConversationCookie(req, res);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const setCookie = setHeaders["set-cookie"] as string;
    expect(setCookie).toContain(`${COOKIE_NAME}=${id}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=2592000"); // 30 days
  });

  it("issues a new uuid when cookie value is malformed", () => {
    const { req, res, setHeaders } = mockReqRes(`${COOKIE_NAME}=not-a-uuid`);
    const id = getOrSetConversationCookie(req, res);
    expect(id).not.toBe("not-a-uuid");
    expect(setHeaders["set-cookie"]).toBeDefined();
  });

  it("includes Secure when NODE_ENV=production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { req, res, setHeaders } = mockReqRes();
      getOrSetConversationCookie(req, res);
      expect((setHeaders["set-cookie"] as string)).toContain("Secure");
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run lib/marketing/cookie.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/marketing/cookie.ts
import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const COOKIE_NAME = "mally_cid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the visitor's anonymous conversation_id, issuing+setting a new
 * cookie if none is present or the existing value is malformed.
 */
export function getOrSetConversationCookie(req: VercelRequest, res: VercelResponse): string {
  const existing = parseCookie(req.headers?.cookie);
  if (existing && UUID_RE.test(existing)) return existing;

  const id = randomUUID();
  const parts = [
    `${COOKIE_NAME}=${id}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
  return id;
}

function parseCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const piece of header.split(";")) {
    const [k, v] = piece.trim().split("=");
    if (k === COOKIE_NAME) return v ?? null;
  }
  return null;
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm vitest run lib/marketing/cookie.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/marketing/cookie.ts lib/marketing/cookie.test.ts
git commit -m "feat(marketing): conversation_id cookie helper (HttpOnly, 30d)"
```

---

## Task 5: Rate limiter

**Files:**
- Create: `lib/marketing/rate-limit.ts`
- Test: `lib/marketing/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/marketing/rate-limit.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { assertRateLimit, RateLimitError, LIMITS } from "./rate-limit";

function makeMockSupabase() {
  // Simulates Postgres INSERT ... ON CONFLICT DO UPDATE RETURNING count.
  // In-memory bucket store keyed by bucket_key.
  const store = new Map<string, number>();
  const rpc = vi.fn(async (_fn: string, args: { p_key: string; p_expires_at: string }) => {
    const next = (store.get(args.p_key) ?? 0) + 1;
    store.set(args.p_key, next);
    return { data: next, error: null };
  });
  return { rpc, store };
}

describe("assertRateLimit", () => {
  let supabase: any;
  let store: Map<string, number>;

  beforeEach(() => {
    const m = makeMockSupabase();
    supabase = m;
    store = m.store;
  });

  it("passes when all buckets are under their limits", async () => {
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip1", conversationId: "c1", sessionCostCents: 0 }),
    ).resolves.toBeUndefined();
  });

  it("throws RateLimitError when per-IP-per-minute exceeds limit", async () => {
    for (let i = 0; i < LIMITS.IP_PER_MIN; i++) {
      await assertRateLimit(supabase as any, { ipHash: "ip-burst", conversationId: `c${i}`, sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip-burst", conversationId: "c-final", sessionCostCents: 0 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws RateLimitError when per-conversation message cap exceeded", async () => {
    for (let i = 0; i < LIMITS.CONV_MAX_MESSAGES; i++) {
      await assertRateLimit(supabase as any, { ipHash: "ipA", conversationId: "c-long", sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ipA", conversationId: "c-long", sessionCostCents: 0 }),
    ).rejects.toMatchObject({ scope: "conversation_messages" });
  });

  it("throws RateLimitError when session cost cap exceeded", async () => {
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ipA", conversationId: "c-spendy", sessionCostCents: LIMITS.CONV_MAX_COST_CENTS + 1 }),
    ).rejects.toMatchObject({ scope: "conversation_cost" });
  });

  it("throws RateLimitError when global daily cap exceeded", async () => {
    for (let i = 0; i < LIMITS.GLOBAL_PER_DAY; i++) {
      await assertRateLimit(supabase as any, { ipHash: `ip-${i}`, conversationId: `c-${i}`, sessionCostCents: 0 });
    }
    await expect(
      assertRateLimit(supabase as any, { ipHash: "ip-overflow", conversationId: "c-overflow", sessionCostCents: 0 }),
    ).rejects.toMatchObject({ scope: "global_daily" });
  });
});
```

- [ ] **Step 2: Write the Postgres RPC the rate limiter calls**

Append to `supabase/migrations/056_marketing_ally.sql`:

```sql

-- 4. Atomic increment-and-return for rate-limit buckets.
create or replace function marketing_chat_rate_limit_bump(
  p_key text,
  p_expires_at timestamptz
) returns int language plpgsql as $$
declare
  v_count int;
begin
  insert into marketing_chat_rate_limits (bucket_key, count, window_start, expires_at)
  values (p_key, 1, now(), p_expires_at)
  on conflict (bucket_key) do update set count = marketing_chat_rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
```

- [ ] **Step 3: Run test to confirm failure**

Run: `pnpm vitest run lib/marketing/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the limiter**

```typescript
// lib/marketing/rate-limit.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const LIMITS = {
  IP_PER_MIN: 5,
  IP_PER_DAY: 50,
  CONV_MAX_MESSAGES: 30,
  CONV_MAX_COST_CENTS: 100, // $1.00
  GLOBAL_PER_DAY: Number(process.env.MARKETING_ALLY_DAILY_CAP ?? 500),
} as const;

export type RateLimitScope =
  | "ip_per_min"
  | "ip_per_day"
  | "conversation_messages"
  | "conversation_cost"
  | "global_daily";

export class RateLimitError extends Error {
  constructor(
    public readonly scope: RateLimitScope,
    public readonly retryAfterSeconds: number,
  ) {
    super(`rate limit hit: ${scope}`);
    this.name = "RateLimitError";
  }
}

interface AssertInput {
  ipHash: string;
  conversationId: string;
  /** Cumulative cost cents already recorded against this conversation. */
  sessionCostCents: number;
}

export async function assertRateLimit(
  supabase: SupabaseClient,
  { ipHash, conversationId, sessionCostCents }: AssertInput,
): Promise<void> {
  // 1. Conversation cost cap (cheapest check, no DB hit)
  if (sessionCostCents > LIMITS.CONV_MAX_COST_CENTS) {
    throw new RateLimitError("conversation_cost", 0);
  }

  const now = new Date();
  const minuteKey = formatYYYYMMDDHHMM(now);
  const dayKey = formatYYYYMMDD(now);

  // 2. Global daily cap
  await bump(supabase, `global:${dayKey}`, oneDayFromNow(now), LIMITS.GLOBAL_PER_DAY, "global_daily", 86400);

  // 3. Per-IP per minute (burst)
  await bump(supabase, `ip:${ipHash}:min:${minuteKey}`, oneMinuteFromNow(now), LIMITS.IP_PER_MIN, "ip_per_min", 60);

  // 4. Per-IP per day
  await bump(supabase, `ip:${ipHash}:day:${dayKey}`, oneDayFromNow(now), LIMITS.IP_PER_DAY, "ip_per_day", 86400);

  // 5. Per-conversation message count
  await bump(supabase, `conv:${conversationId}:msgs`, oneDayFromNow(now), LIMITS.CONV_MAX_MESSAGES, "conversation_messages", 0);
}

async function bump(
  supabase: SupabaseClient,
  key: string,
  expiresAt: Date,
  limit: number,
  scope: RateLimitScope,
  retryAfterSeconds: number,
) {
  const { data, error } = await supabase.rpc("marketing_chat_rate_limit_bump", {
    p_key: key,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`rate-limit bump failed (${scope}): ${error.message}`);
  if ((data as number) > limit) throw new RateLimitError(scope, retryAfterSeconds);
}

function formatYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function formatYYYYMMDDHHMM(d: Date): string {
  return `${formatYYYYMMDD(d)}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}
function pad(n: number): string { return n.toString().padStart(2, "0"); }
function oneMinuteFromNow(d: Date): Date { return new Date(d.getTime() + 60_000); }
function oneDayFromNow(d: Date): Date { return new Date(d.getTime() + 86_400_000); }
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run lib/marketing/rate-limit.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/marketing/rate-limit.ts lib/marketing/rate-limit.test.ts supabase/migrations/056_marketing_ally.sql
git commit -m "feat(marketing): per-IP/per-conv/global rate limiter via Postgres bump RPC"
```

---

## Task 6: Refactor Pricing.tsx & FAQ.tsx to export named constants

**Files:**
- Modify: `src/v2/components/landing/Pricing.tsx`
- Modify: `src/v2/components/landing/FAQ.tsx`
- Test: existing visual rendering must be unchanged.

- [ ] **Step 1: Read current Pricing.tsx and identify the inline pricing data**

Run: `cat src/v2/components/landing/Pricing.tsx | head -60`

Identify the array of tier objects that's currently inlined inside the JSX (e.g., `{[{ name: 'Single', price: '$X', includes: [...] }, ...].map(...)}`). Lift it to a top-level `export const PRICING_TIERS = [...] as const;` above the component, then reference `PRICING_TIERS.map(...)` in the JSX.

- [ ] **Step 2: Apply the refactor to Pricing.tsx**

Concrete shape of the export (matching whatever's already in the JSX — adjust field names to match):

```typescript
// At top of src/v2/components/landing/Pricing.tsx, above the component:
export interface PricingTier {
  name: string;
  price: string;
  cadence?: string;       // e.g. "/listing", "/mo"
  includes: string[];
  cta: string;
  popular?: boolean;
}

export const PRICING_TIERS: readonly PricingTier[] = [
  // ... lift current inline data here, exact field names mirroring current JSX
] as const;
```

Update the JSX inside the component to map over `PRICING_TIERS` instead of the inline array. **No visual change.**

- [ ] **Step 3: Apply the same refactor to FAQ.tsx**

```typescript
// At top of src/v2/components/landing/FAQ.tsx:
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  // ... lift current inline FAQ data here
] as const;
```

- [ ] **Step 4: Run any existing landing-page tests**

Run: `pnpm vitest run src/v2/components/landing/`
Expected: PASS (or no tests in that dir, which is fine).

- [ ] **Step 5: Smoke render in dev**

Run: `pnpm dev` (background)
Open `http://localhost:5173/` in a browser, scroll to Pricing + FAQ sections, confirm they render identically to before.
Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/v2/components/landing/Pricing.tsx src/v2/components/landing/FAQ.tsx
git commit -m "refactor(landing): extract PRICING_TIERS + FAQ_ITEMS constants for build-time reuse"
```

---

## Task 7: Knowledge build script

**Files:**
- Create: `lib/marketing/build-knowledge.ts`
- Test: `lib/marketing/build-knowledge.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/marketing/build-knowledge.test.ts
import { describe, it, expect } from "vitest";
import { buildKnowledge } from "./build-knowledge";
import { PRICING_TIERS } from "../../src/v2/components/landing/Pricing";
import { FAQ_ITEMS } from "../../src/v2/components/landing/FAQ";

describe("buildKnowledge", () => {
  it("emits pricing.json matching PRICING_TIERS", () => {
    const out = buildKnowledge();
    expect(JSON.parse(out.pricingJson)).toEqual(PRICING_TIERS);
  });

  it("emits faq.json matching FAQ_ITEMS", () => {
    const out = buildKnowledge();
    expect(JSON.parse(out.faqJson)).toEqual(FAQ_ITEMS);
  });

  it("throws if PRICING_TIERS is empty (regression guard)", async () => {
    // Direct invariant — the source files must not be empty.
    expect(PRICING_TIERS.length).toBeGreaterThan(0);
    expect(FAQ_ITEMS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm vitest run lib/marketing/build-knowledge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/marketing/build-knowledge.ts
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICING_TIERS } from "../../src/v2/components/landing/Pricing.js";
import { FAQ_ITEMS } from "../../src/v2/components/landing/FAQ.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildKnowledge(): { pricingJson: string; faqJson: string } {
  if (!PRICING_TIERS || PRICING_TIERS.length === 0) {
    throw new Error("PRICING_TIERS export is missing or empty in src/v2/components/landing/Pricing.tsx");
  }
  if (!FAQ_ITEMS || FAQ_ITEMS.length === 0) {
    throw new Error("FAQ_ITEMS export is missing or empty in src/v2/components/landing/FAQ.tsx");
  }
  return {
    pricingJson: JSON.stringify(PRICING_TIERS, null, 2),
    faqJson: JSON.stringify(FAQ_ITEMS, null, 2),
  };
}

// CLI entrypoint: `tsx lib/marketing/build-knowledge.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { pricingJson, faqJson } = buildKnowledge();
  writeFileSync(resolve(__dirname, "pricing.json"), pricingJson);
  writeFileSync(resolve(__dirname, "faq.json"), faqJson);
  console.log("[build-knowledge] wrote pricing.json + faq.json");
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm vitest run lib/marketing/build-knowledge.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the script for real**

Run: `pnpm tsx lib/marketing/build-knowledge.ts`
Expected: writes `lib/marketing/pricing.json` + `lib/marketing/faq.json`. Output: `[build-knowledge] wrote pricing.json + faq.json`.

- [ ] **Step 6: Verify generated files**

Run: `cat lib/marketing/pricing.json | head -20`
Expected: JSON array matching the tiers shape.

- [ ] **Step 7: Add to .gitignore**

Append to `.gitignore`:
```
# Generated by lib/marketing/build-knowledge.ts
lib/marketing/pricing.json
lib/marketing/faq.json
```

- [ ] **Step 8: Wire into package.json**

In `package.json`, add a `prebuild` script (Vite runs `prebuild` before `build` automatically when invoked via `npm run build`/`pnpm build`):

```json
"scripts": {
  "prebuild": "tsx lib/marketing/build-knowledge.ts",
  "build": "vite build",
  ...existing scripts
}
```

If a `prebuild` script already exists, append the command with `&&`.

- [ ] **Step 9: Verify build pipeline runs the script**

Run: `pnpm build`
Expected: Output includes `[build-knowledge] wrote pricing.json + faq.json` BEFORE Vite output. Build succeeds.

- [ ] **Step 10: Commit**

```bash
git add lib/marketing/build-knowledge.ts lib/marketing/build-knowledge.test.ts .gitignore package.json
git commit -m "feat(marketing): build-knowledge script extracts pricing+FAQ to JSON at build time"
```

---

## Task 8: Chat endpoint

**Files:**
- Create: `lib/marketing/knowledge.md`
- Create: `api/marketing/ally-chat.ts`
- Test: `api/marketing/ally-chat.test.ts`

This is the largest task. Three sub-pieces: the curated knowledge file, the system prompt builder, and the handler with tests.

- [ ] **Step 1: Write the curated knowledge.md**

Create `lib/marketing/knowledge.md` — ~2KB plain markdown. Sections per spec §8.1. **No Helgemo references.**

```markdown
# Listing Elevate — Knowledge Base

(This file is loaded verbatim into Ally's system prompt. Update it whenever
the product changes — Ally is automatically smarter on next deploy.
KEEP UNDER ~2KB / ~800 tokens.)

## What is Listing Elevate?

Listing Elevate is a fully-autonomous cinematic video pipeline for real
estate listings. Agents upload property photos and order details; we
generate a finished MP4 in 9:16 (vertical) and/or 16:9 (horizontal) and
deliver it via email — no human touches the video.

## What you get

- Cinematic AI-generated video of the property
- Vertical (9:16) for Reels/TikTok/Shorts, or horizontal (16:9) for YouTube/web
- Multiple duration options (15s, 30s, 60s) — agent's choice at order time
- Optional voiceover (AI or your own clone)
- Brokerage logo + brand colors burned into the final video

## How it works

1. Sign up and create an account (60 seconds).
2. Upload 10–60 photos of the property along with the listing details (address, beds/baths, price, etc.).
3. We analyze the photos, plan the scenes, generate motion clips, and assemble the final video automatically.
4. Finished video lands in your inbox.

## Turnaround

Typical turnaround is under an hour from upload to delivered video. Larger orders or peak demand may take longer; we'll always email you when it's ready.

## What you need from the agent

- 10–60 high-resolution property photos (interior + exterior).
- Listing basics: address, beds, baths, square footage, asking price.
- Optional: agent name, brokerage, contact info, voiceover script.

## Who Listing Elevate is for

Listing agents, real estate teams, brokerages, and listing photographers who want cinematic listing videos without hiring a videographer or editing them by hand.

## What Ally cannot do (yet)

- Place an order on the visitor's behalf — sign up and the order form takes ~60 seconds.
- Show a sample video of a *specific* property — but the homepage has selected work above the chat.
- Quote custom enterprise pricing — for high-volume teams, capture an email and the team will follow up.
- Schedule a meeting — book/call functionality is on the roadmap.

## Founder

Listing Elevate is built by a small founding team obsessed with making
agent marketing assets ten times faster than the traditional video
production workflow.
```

- [ ] **Step 2: Write the failing test for the handler**

```typescript
// api/marketing/ally-chat.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "./ally-chat";

// Mocked module-level deps
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor(_opts: unknown) {}
      messages = {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: MOCK_ASSISTANT_REPLY }],
          usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 },
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
        })),
      };
    },
  };
});

vi.mock("../../lib/client.js", () => ({
  getSupabase: () => makeSupabaseStub(),
}));

vi.mock("../../lib/marketing/rate-limit.js", () => ({
  assertRateLimit: vi.fn(async () => undefined),
  RateLimitError: class extends Error {
    constructor(public scope: string, public retryAfterSeconds: number) { super(scope); }
  },
  LIMITS: { IP_PER_MIN: 5, IP_PER_DAY: 50, CONV_MAX_MESSAGES: 30, CONV_MAX_COST_CENTS: 100, GLOBAL_PER_DAY: 500 },
}));

const MOCK_ASSISTANT_REPLY = `<reply>
Hey! Most listings turn around in under an hour. Want me to walk you through how to get started?
</reply>
<ally_followup_chips>
What do you need from me?; Show me pricing; How does it work?
</ally_followup_chips>
<ally_cta>
get_started
</ally_cta>`;

function makeSupabaseStub() {
  const inserts: any[] = [];
  const updates: any[] = [];
  return {
    inserts, updates,
    from: (table: string) => ({
      insert: (rows: any) => { inserts.push({ table, rows }); return { error: null }; },
      upsert: (rows: any, opts?: any) => { updates.push({ table, rows, opts }); return { error: null, data: rows }; },
      update: (changes: any) => ({
        eq: (_col: string, _val: any) => { updates.push({ table, changes }); return { error: null }; },
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { conversation: [], total_messages: 0, total_cost_cents: 0 }, error: null }) }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: 1, error: null })),
  };
}

function makeReqRes(body: unknown) {
  const req: any = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7", cookie: "" },
    body,
    socket: { remoteAddress: "203.0.113.7" },
  };
  let statusCode = 200;
  let payload: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    status(code: number) { statusCode = code; return res; },
    json(data: any) { payload = data; return res; },
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    end() { return res; },
  };
  return { req, res, get statusCode() { return statusCode; }, get payload() { return payload; }, headers };
}

beforeEach(() => {
  process.env.IP_HASH_SALT = "test-salt";
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("POST /api/marketing/ally-chat", () => {
  it("returns 405 for non-POST", async () => {
    const ctx = makeReqRes({});
    ctx.req.method = "GET";
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(405);
  });

  it("returns 400 when messages is missing", async () => {
    const ctx = makeReqRes({});
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(400);
  });

  it("returns parsed reply + followup_chips + cta on a valid request", async () => {
    const ctx = makeReqRes({ messages: [{ role: "user", content: "How long does turnaround take?" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(200);
    expect(ctx.payload.reply).toMatch(/under an hour/);
    expect(ctx.payload.followup_chips).toEqual([
      "What do you need from me?",
      "Show me pricing",
      "How does it work?",
    ]);
    expect(ctx.payload.cta).toBe("get_started");
    expect(ctx.payload.lead_capture).toBeNull();
  });

  it("issues a Set-Cookie when no cookie is present", async () => {
    const ctx = makeReqRes({ messages: [{ role: "user", content: "hi" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.headers["set-cookie"]).toContain("mally_cid=");
  });

  it("returns 429 when rate limit is hit", async () => {
    const { assertRateLimit, RateLimitError } = await import("../../lib/marketing/rate-limit.js");
    (assertRateLimit as any).mockImplementationOnce(async () => {
      throw new (RateLimitError as any)("ip_per_min", 60);
    });
    const ctx = makeReqRes({ messages: [{ role: "user", content: "hi" }] });
    await handler(ctx.req, ctx.res);
    expect(ctx.statusCode).toBe(429);
    expect(ctx.headers["retry-after"]).toBe("60");
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run: `pnpm vitest run api/marketing/ally-chat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the handler**

```typescript
// api/marketing/ally-chat.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../../lib/client.js";
import { recordCost } from "../../lib/cost.js";
import { hashIp } from "../../lib/marketing/hash-ip.js";
import { getOrSetConversationCookie } from "../../lib/marketing/cookie.js";
import { assertRateLimit, RateLimitError, LIMITS } from "../../lib/marketing/rate-limit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;

// Sonnet 4.6 pricing (USD per 1M tokens). Update if Anthropic changes pricing.
const PRICE_PER_M_INPUT = 3.0;
const PRICE_PER_M_OUTPUT = 15.0;
const PRICE_PER_M_CACHE_READ = 0.3;     // 10% of input
const PRICE_PER_M_CACHE_WRITE = 3.75;   // 1.25× input

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

let _knowledge: string | null = null;
function loadKnowledge(): string {
  if (_knowledge !== null) return _knowledge;
  const path = resolve(__dirname, "../../lib/marketing/knowledge.md");
  _knowledge = readFileSync(path, "utf8");
  return _knowledge;
}

let _pricingJson: string | null = null;
function loadPricing(): string {
  if (_pricingJson !== null) return _pricingJson;
  const path = resolve(__dirname, "../../lib/marketing/pricing.json");
  _pricingJson = readFileSync(path, "utf8");
  return _pricingJson;
}

let _faqJson: string | null = null;
function loadFaq(): string {
  if (_faqJson !== null) return _faqJson;
  const path = resolve(__dirname, "../../lib/marketing/faq.json");
  _faqJson = readFileSync(path, "utf8");
  return _faqJson;
}

const BASE_PROMPT = `You are Ally, the AI concierge for Listing Elevate — a SaaS that produces fully-autonomous cinematic videos for real-estate listings. You greet visitors on the public marketing homepage, answer their questions about the product, and gently route interested visitors toward signing up.

VOICE
- Warm, knowledgeable, low-pressure. No exclamation-mark spam. No "Absolutely!" / "Great question!" filler.
- Speak as "we" or "Listing Elevate". Never as a named individual.
- One question at a time. Brief — 1–4 sentences per reply.
- Use ONLY facts present in the KNOWLEDGE / PRICING / FAQ sections below. If you don't have a fact, say so plainly: "I don't have that locked down — want me to flag it for the team to follow up?"

HARD RULES
- Listing Elevate is multi-tenant SaaS for real-estate agents. NEVER mention "Helgemo Team", "Punta Gorda", "Charlotte County", "Burnt Store Isles", "The Isles", any specific brokerage, any specific city, or any specific person's name. You are brand-neutral and agent-agnostic.
- If asked who/what you are: "I'm Listing Elevate's AI concierge — happy to answer most things, and a real human is one email away if you'd rather."
- Never claim to be human.
- Never invent pricing, turnaround, or feature claims. If it's not in PRICING / KNOWLEDGE / FAQ, you don't know it.

OUTPUT FORMAT — STRICT
Wrap each piece of structured output in the exact section tag. Always emit <reply>. Omit other sections when they don't apply.

<reply>
1–4 sentences of plain prose. Always present.
</reply>

<ally_followup_chips>
Up to 3 short follow-up suggestions, semicolon-separated.
e.g. "What do you need from me?; Show me pricing; How does it work?"
Emit when the conversation has natural next questions; omit on closing turns.
</ally_followup_chips>

<ally_cta>
One word: get_started
Emit when the visitor signals intent ("how do I sign up", "what's next", "I want one for my listing", "can I try it"). When emitted, ALSO mention it in <reply>.
</ally_cta>

<ally_lead_capture>
JSON object: {"name": "...", "email": "...", "phone": "...", "role": "agent|broker|other", "intent": "..."}
Emit ONLY when the visitor has volunteered fields in conversation. Never invent values. Never include a field the visitor didn't share.
</ally_lead_capture>

SOFT EMAIL ASK
On turn 4 or later, IF no email is on file (CONVERSATION_META.has_email = false) AND the visitor has asked at least 2 substantive product questions, append one soft line at the end of <reply>: "By the way — want me to email you a one-pager you can come back to?" Never repeat this more than twice in a session. Never block the conversation.`;

function buildSystemBlocks(meta: { turn: number; has_email: boolean; source_url: string }) {
  return [
    { type: "text" as const, text: BASE_PROMPT, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## KNOWLEDGE\n\n${loadKnowledge()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## PRICING\n\n${loadPricing()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## FAQ\n\n${loadFaq()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## CONVERSATION_META\nturn: ${meta.turn}\nhas_email: ${meta.has_email}\nsource_url: ${meta.source_url}` },
  ];
}

interface ChatMessage { role: "user" | "assistant"; content: string; }

interface LeadCapture { name?: string; email?: string; phone?: string; role?: string; intent?: string; }

interface ChatResponseBody {
  reply: string;
  followup_chips: string[] | null;
  cta: "get_started" | null;
  lead_capture: LeadCapture | null;
  conversation_id: string;
  cost_cents: number;
  model: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  // 1. Parse + validate body
  const body = req.body as { messages?: unknown };
  const messagesRaw = body?.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return res.status(400).json({ error: "messages[] required" });
  }
  const messages: ChatMessage[] = [];
  for (const m of messagesRaw.slice(-MAX_MESSAGES)) {
    const mm = m as any;
    if (!mm || (mm.role !== "user" && mm.role !== "assistant")) {
      return res.status(400).json({ error: "each message needs role user|assistant" });
    }
    if (typeof mm.content !== "string" || mm.content.length === 0) {
      return res.status(400).json({ error: "each message needs string content" });
    }
    messages.push({ role: mm.role, content: mm.content.slice(0, MAX_MESSAGE_CHARS) });
  }

  // 2. Identity + cookie
  const conversationId = getOrSetConversationCookie(req, res);
  const ipHash = hashIp(req);
  const sourceUrl = (req.headers?.referer as string | undefined) ?? "";

  // 3. Load existing conversation row to get cumulative cost / has_email
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("marketing_leads")
    .select("conversation, total_messages, total_cost_cents, email")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  const sessionCostCents = existing?.total_cost_cents ?? 0;
  const hasEmail = Boolean(existing?.email);

  // 4. Rate-limit
  try {
    await assertRateLimit(supabase, { ipHash, conversationId, sessionCostCents });
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
      return res.status(429).json({ error: "rate_limit", scope: err.scope });
    }
    throw err;
  }

  // 5. Build system + call Anthropic
  const systemBlocks = buildSystemBlocks({
    turn: messages.length,
    has_email: hasEmail,
    source_url: sourceUrl,
  });

  const result = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks as any,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  // 6. Parse reply text
  const text = result.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  const reply = extractTag(text, "reply") ?? text.trim();
  const chipsRaw = extractTag(text, "ally_followup_chips");
  const followup_chips = chipsRaw
    ? chipsRaw.split(";").map(s => s.trim()).filter(Boolean).slice(0, 3)
    : null;
  const ctaRaw = extractTag(text, "ally_cta")?.trim();
  const cta = ctaRaw === "get_started" ? "get_started" : null;
  const leadRaw = extractTag(text, "ally_lead_capture");
  let lead_capture: LeadCapture | null = null;
  if (leadRaw) {
    try {
      const parsed = JSON.parse(leadRaw);
      if (parsed && typeof parsed === "object") lead_capture = parsed;
    } catch { /* ignore malformed JSON from model */ }
  }

  // 7. Compute cost
  const usage = (result as any).usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const costCents = Math.round(
    ((inputTokens * PRICE_PER_M_INPUT)
      + (outputTokens * PRICE_PER_M_OUTPUT)
      + (cacheReadTokens * PRICE_PER_M_CACHE_READ)
      + (cacheCreationTokens * PRICE_PER_M_CACHE_WRITE)
    ) / 1_000_000 * 100,
  );

  // 8. Persist thread + cost
  const updatedThread = [
    ...(existing?.conversation as ChatMessage[] ?? []),
    messages[messages.length - 1],
    { role: "assistant" as const, content: text },
  ].slice(-MAX_MESSAGES);

  const lead_email = lead_capture?.email ?? existing?.email ?? null;
  const upsertRow: Record<string, unknown> = {
    conversation_id: conversationId,
    conversation: updatedThread,
    source_url: sourceUrl,
    ip_hash: ipHash,
    user_agent: (req.headers?.["user-agent"] as string | undefined) ?? null,
    total_messages: (existing?.total_messages ?? 0) + 1,
    total_cost_cents: sessionCostCents + costCents,
  };
  if (lead_capture) {
    if (lead_capture.email) upsertRow.email = lead_capture.email;
    if (lead_capture.name) upsertRow.name = lead_capture.name;
    if (lead_capture.phone) upsertRow.phone = lead_capture.phone;
    if (lead_capture.role) upsertRow.role = lead_capture.role;
    if (lead_capture.intent) upsertRow.intent = lead_capture.intent;
  }
  await supabase.from("marketing_leads").upsert([upsertRow], { onConflict: "conversation_id" });

  await recordCost(supabase, {
    stage: "marketing_chat",
    cost_cents: costCents,
    provider: "anthropic",
    metadata: {
      conversation_id: conversationId,
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      ip_hash: ipHash,
      source_url: sourceUrl,
    },
  });

  // 9. Respond
  const responseBody: ChatResponseBody = {
    reply,
    followup_chips,
    cta,
    lead_capture,
    conversation_id: conversationId,
    cost_cents: costCents,
    model: MODEL,
  };
  return res.status(200).json(responseBody);
}

function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm vitest run api/marketing/ally-chat.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Type-check api**

Run: `pnpm tsc -p tsconfig.api.json --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add lib/marketing/knowledge.md api/marketing/ally-chat.ts api/marketing/ally-chat.test.ts
git commit -m "feat(marketing): /api/marketing/ally-chat — Sonnet 4.6 + caching + lead upsert"
```

---

## ⏸ Midpoint checkpoint

Backend is complete and unit-tested. **STOP HERE** and verify with the user before starting UI tasks.

Verify by running the smoke script (Task 16 has the full version, but a quick manual curl works):

```bash
# Apply the migration to a Supabase branch first (don't touch prod yet):
# Use Supabase MCP `apply_migration` against a non-prod branch.

# Then locally:
pnpm dev   # in another shell
curl -X POST http://localhost:5173/api/marketing/ally-chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How long does it take?"}]}'
# Expected: 200 with reply + followup_chips + (optional) cta
```

Report back to user before continuing.

---

## Task 9: AllyAvatar component

**Files:**
- Create: `src/components/marketing/AllyAvatar.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/marketing/AllyAvatar.tsx
import type { ComponentProps } from "react";

interface AllyAvatarProps extends Omit<ComponentProps<"div">, "children"> {
  size?: number;
}

/**
 * Custom illustrated mark for Ally — geometric lowercase "a" inside a
 * rounded square, brand-blue background, white glyph. Inline SVG, no
 * dependencies, no licensed art.
 */
export function AllyAvatar({ size = 32, className = "", ...rest }: AllyAvatarProps) {
  return (
    <div
      {...rest}
      className={`inline-flex items-center justify-center rounded-lg bg-accent text-accent-foreground ${className}`}
      style={{ width: size, height: size }}
      aria-label="Ally"
    >
      <svg
        width={size * 0.65}
        height={size * 0.65}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Stylized lowercase "a" — geometric, rounded terminal */}
        <path
          d="M16 8.5c0-2.485-2.015-4.5-4.5-4.5S7 6.015 7 8.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="14.5" r="5.5" stroke="currentColor" strokeWidth="2.4" />
        <path d="M17 9v11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Smoke render**

In a temporary dev page or Storybook, render `<AllyAvatar size={32} />`. Confirm: rounded blue square, white "a" glyph, ~70% glyph height, no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/marketing/AllyAvatar.tsx
git commit -m "feat(marketing): AllyAvatar — illustrated SVG mark"
```

---

## Task 10: AllyChip component

**Files:**
- Create: `src/components/marketing/AllyChip.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/marketing/AllyChip.tsx
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AllyChipProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Quick-reply / suggested-reply pill. Outline style with brand accent
 * border + text, fills on hover.
 */
export function AllyChip({ label, onClick, disabled, className }: AllyChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-background px-3 py-1.5",
        "text-sm font-medium text-accent transition-colors",
        "hover:bg-accent/10 hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
    >
      <Sparkles size={14} className="opacity-70" />
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/marketing/AllyChip.tsx
git commit -m "feat(marketing): AllyChip — quick-reply pill"
```

---

## Task 11: AllyCTACard component

**Files:**
- Create: `src/components/marketing/AllyCTACard.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/marketing/AllyCTACard.tsx
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AllyCTACardProps {
  onGetStarted: () => void;
}

/**
 * Expanded CTA card emitted when Ally returns <ally_cta>get_started.
 * Single primary action: opens the LoginDialog (sign-up tab).
 */
export function AllyCTACard({ onGetStarted }: AllyCTACardProps) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
      <p className="text-sm font-medium text-foreground">Ready to get started?</p>
      <Button
        onClick={onGetStarted}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
      >
        Create my account
        <ArrowRight size={16} className="ml-2" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/marketing/AllyCTACard.tsx
git commit -m "feat(marketing): AllyCTACard — get_started call to action"
```

---

## Task 12: Frontend API client

**Files:**
- Create: `src/lib/marketing/api-client.ts`

- [ ] **Step 1: Implement**

```typescript
// src/lib/marketing/api-client.ts

export interface MarketingChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MarketingChatLeadCapture {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  intent?: string;
}

export interface MarketingChatResponse {
  reply: string;
  followup_chips: string[] | null;
  cta: "get_started" | null;
  lead_capture: MarketingChatLeadCapture | null;
  conversation_id: string;
  cost_cents: number;
  model: string;
}

export interface MarketingChatError {
  error: string;
  scope?: string;
}

export async function marketingAllyChat(
  messages: MarketingChatMessage[],
): Promise<MarketingChatResponse> {
  const res = await fetch("/api/marketing/ally-chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as MarketingChatError;
    throw new Error(err.error ?? `chat failed (${res.status})`);
  }
  return (await res.json()) as MarketingChatResponse;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/marketing/api-client.ts
git commit -m "feat(marketing): frontend api-client + types"
```

---

## Task 13: MarketingAllyChat widget

**Files:**
- Create: `src/components/marketing/MarketingAllyChat.tsx`

This is the largest UI task. Lift `AllyFloatingChat.tsx` from `src/components/blog/`, then strip:
- All "Apply" / form-patching logic (no parent form to patch on the marketing page)
- Research toggle + research-suggest pill (no Gemini grounding on this surface)
- Attachments (no file uploads on the public surface)

…and add:
- Starter chips tuned for marketing intents
- `AllyChip` row for follow-up chips
- `AllyCTACard` when `cta === "get_started"`
- Inline lead-capture mini-form when `lead_capture` is returned with at least one field
- "Get started" handler that opens the existing `LoginDialog`

- [ ] **Step 1: Read the source widget**

Run: `cat src/components/blog/AllyFloatingChat.tsx | head -80`

Note structure: motion-wrapped Popover, header with avatar/title, scrollable thread, composer with AutoGrowTextarea + send button. Mirror the same outer shell.

- [ ] **Step 2: Implement**

```tsx
// src/components/marketing/MarketingAllyChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ArrowUp, ChevronUp, Loader2, MessageSquare, RotateCcw, X } from "lucide-react";
import { useAllyStatus, AllyPulse, AutoGrowTextarea } from "@/components/blog/ally-status";
import { AllyAvatar } from "./AllyAvatar";
import { AllyChip } from "./AllyChip";
import { AllyCTACard } from "./AllyCTACard";
import {
  marketingAllyChat,
  type MarketingChatMessage,
  type MarketingChatResponse,
} from "@/lib/marketing/api-client";

const STARTER_CHIPS = [
  "How does it work?",
  "Show me pricing",
  "What do you need from me?",
];

interface ThreadEntry {
  id: string;
  message: MarketingChatMessage;
  /** Only set on assistant entries. */
  meta?: {
    followup_chips: string[] | null;
    cta: "get_started" | null;
    lead_capture: MarketingChatResponse["lead_capture"];
  };
}

interface MarketingAllyChatProps {
  /** Called when Ally's CTA card is clicked or the user explicitly asks to sign up. */
  onGetStarted: () => void;
}

export function MarketingAllyChat({ onGetStarted }: MarketingAllyChatProps) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadEntry[]>(() => initialThread());
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const messages = thread
        .map(t => t.message)
        .concat({ role: "user", content: text });
      return marketingAllyChat(messages);
    },
    onMutate: (text) => {
      setThread(prev => [
        ...prev,
        { id: crypto.randomUUID(), message: { role: "user", content: text } },
      ]);
      setDraft("");
    },
    onSuccess: (resp) => {
      setThread(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: { role: "assistant", content: resp.reply },
          meta: {
            followup_chips: resp.followup_chips,
            cta: resp.cta,
            lead_capture: resp.lead_capture,
          },
        },
      ]);
    },
    onError: (err: Error) => {
      setThread(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: { role: "assistant", content: `Sorry — ${err.message}. Try again in a sec.` },
        },
      ]);
    },
  });

  // useAllyStatus rotates through phase strings while `active` is true.
  // Tie to send.isPending so the status text rotates while Ally is thinking.
  const status = useAllyStatus(send.isPending, /* research */ false);

  // Autoscroll on new messages
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, send.isPending]);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  };

  const handleChip = (chip: string) => {
    if (send.isPending) return;
    send.mutate(chip);
  };

  const handleReset = () => {
    setThread(initialThread());
    setDraft("");
  };

  // Find the latest assistant entry to pull chips/cta off
  const lastAssistant = useMemo(
    () => [...thread].reverse().find(t => t.message.role === "assistant"),
    [thread],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-background border border-border shadow-lg px-4 py-3 hover:shadow-xl transition-shadow"
          aria-label="Open chat with Ally"
        >
          <AllyAvatar size={24} />
          <span className="text-sm font-medium text-foreground">Chat with Ally</span>
          <ChevronUp size={16} className="text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        className="p-0 w-[360px] sm:w-[360px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-6rem)] rounded-2xl shadow-2xl border-border overflow-hidden flex flex-col"
      >
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col h-full"
          >
            {/* Header */}
            <div className="flex flex-col items-center pt-4 pb-3 border-b border-border relative">
              <button
                onClick={handleReset}
                className="absolute top-3 right-9 text-muted-foreground hover:text-foreground"
                aria-label="Reset conversation"
                title="Start over"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                aria-label="Minimize chat"
              >
                <X size={16} />
              </button>
              <div className="relative">
                <AllyAvatar size={32} />
                {send.isPending && <AllyPulse size={10} />}
              </div>
              <p className="text-base font-semibold text-foreground mt-2">Ally</p>
              <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {send.isPending ? status : "Active now"}
              </p>
            </div>

            {/* Thread */}
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {thread.map(entry => (
                <Bubble key={entry.id} entry={entry} />
              ))}
              {send.isPending && (
                <div className="self-start text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  {status}
                </div>
              )}
            </div>

            {/* Chips + CTA */}
            {!send.isPending && lastAssistant?.meta && (
              <div className="px-4 pb-2 space-y-2">
                {lastAssistant.meta.followup_chips && lastAssistant.meta.followup_chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {lastAssistant.meta.followup_chips.map(chip => (
                      <AllyChip key={chip} label={chip} onClick={() => handleChip(chip)} />
                    ))}
                  </div>
                )}
                {lastAssistant.meta.cta === "get_started" && (
                  <AllyCTACard onGetStarted={onGetStarted} />
                )}
              </div>
            )}

            {/* Composer */}
            <div className="p-3 border-t border-border flex items-end gap-2">
              <AutoGrowTextarea
                value={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
                placeholder="Ask anything…"
                disabled={send.isPending}
                className="flex-1"
              />
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!draft.trim() || send.isPending}
                className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0"
                aria-label="Send"
              >
                {send.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}

function Bubble({ entry }: { entry: ThreadEntry }) {
  const isUser = entry.message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"
        }`}
      >
        {entry.message.content}
      </div>
    </div>
  );
}

function initialThread(): ThreadEntry[] {
  return [
    {
      id: "ally-intro",
      message: {
        role: "assistant",
        content:
          "Hey 👋 I'm Ally. Ask me anything about Listing Elevate — pricing, how it works, what we need from you — or I can walk you through getting started. What's on your mind?",
      },
      meta: {
        followup_chips: STARTER_CHIPS,
        cta: null,
        lead_capture: null,
      },
    },
  ];
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc -p tsconfig.app.json --noEmit`
Expected: No errors. (Live smoke happens in Task 14 once mounted in V2Landing.)

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/MarketingAllyChat.tsx
git commit -m "feat(marketing): MarketingAllyChat floating widget"
```

---

## Task 14: Mount in V2Landing behind feature flag

**Files:**
- Modify: `src/v2/components/landing/V2Landing.tsx`

- [ ] **Step 1: Read the current V2Landing**

Run: `cat src/v2/components/landing/V2Landing.tsx`
Identify how the existing LoginDialog is opened (`?login=1` URL param per `App.tsx:65`). The widget will trigger the same flow.

- [ ] **Step 2: Add the mount + handler**

At the top of the V2Landing component (or where `useNavigate` is already imported), add:

```tsx
import { useNavigate } from "react-router-dom";
import { MarketingAllyChat } from "@/components/marketing/MarketingAllyChat";

// Inside V2Landing:
const navigate = useNavigate();
const handleGetStarted = () => navigate("/?login=1");
```

At the bottom of the JSX (after Footer, inside the outer wrapper):

```tsx
{import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED === "true" && (
  <MarketingAllyChat onGetStarted={handleGetStarted} />
)}
```

- [ ] **Step 3: Smoke render**

In `.env.local`, set `VITE_HOMEPAGE_ALLY_ENABLED=true`. Run `pnpm dev`, load `/`, confirm:
- Pill is visible bottom-right
- Other landing sections are unchanged
- Clicking the pill opens the widget over the page
- Sending a "I want to sign up" message returns a reply with `<ally_cta>get_started</ally_cta>` and the CTA card; clicking the CTA navigates to `/?login=1` and the existing LoginDialog opens

Then unset the flag (or set `VITE_HOMEPAGE_ALLY_ENABLED=false`), refresh, confirm the pill disappears.

- [ ] **Step 4: Commit**

```bash
git add src/v2/components/landing/V2Landing.tsx
git commit -m "feat(marketing): mount MarketingAllyChat on V2Landing behind VITE_HOMEPAGE_ALLY_ENABLED"
```

---

## Task 15: Cleanup cron + vercel.json

**Files:**
- Create: `api/cron/marketing-ally-cleanup.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Implement the cron handler**

```typescript
// api/cron/marketing-ally-cleanup.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../lib/client.js";

/**
 * Daily janitor:
 *  1. Purges expired marketing_chat_rate_limits buckets.
 *  2. Purges abandoned anonymous marketing_leads (>90d, no email).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron requests carry a known authorization header per project config.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabase = getSupabase();

  const { error: rlErr, count: rlCount } = await supabase
    .from("marketing_chat_rate_limits")
    .delete({ count: "exact" })
    .lt("expires_at", new Date().toISOString());
  if (rlErr) throw new Error(`rate-limit cleanup failed: ${rlErr.message}`);

  const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const { error: leadErr, count: leadCount } = await supabase
    .from("marketing_leads")
    .delete({ count: "exact" })
    .is("email", null)
    .lt("updated_at", cutoff);
  if (leadErr) throw new Error(`lead cleanup failed: ${leadErr.message}`);

  return res.status(200).json({
    ok: true,
    purged_rate_limit_rows: rlCount ?? 0,
    purged_anon_lead_rows: leadCount ?? 0,
  });
}
```

- [ ] **Step 2: Register the cron in vercel.json**

In the `crons` array of `vercel.json`, append:

```json
{ "path": "/api/cron/marketing-ally-cleanup", "schedule": "0 4 * * *" }
```

(Runs daily at 04:00 UTC — same time as `refresh-sku-affinity`, low-traffic window.)

- [ ] **Step 3: Commit**

```bash
git add api/cron/marketing-ally-cleanup.ts vercel.json
git commit -m "feat(marketing): daily cleanup cron (rate-limit buckets + abandoned threads)"
```

---

## Task 16: Smoke script + manual QA + handoff

**Files:**
- Create: `scripts/marketing/test-ally-chat.ts`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Write the conversational smoke script**

```typescript
// scripts/marketing/test-ally-chat.ts
/**
 * End-to-end smoke for the homepage Ally endpoint. Requires the dev server
 * running (pnpm dev) and the migration applied to a non-prod Supabase branch.
 *
 * Usage: BASE_URL=http://localhost:5173 pnpm tsx scripts/marketing/test-ally-chat.ts
 */
import { setTimeout as wait } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface ChatResponse {
  reply: string;
  followup_chips: string[] | null;
  cta: string | null;
  lead_capture: Record<string, string> | null;
  conversation_id: string;
  cost_cents: number;
}

const SCENARIOS: { name: string; turns: string[]; expect: (r: ChatResponse[]) => string | null }[] = [
  {
    name: "pricing question",
    turns: ["How much does this cost?"],
    expect: ([r]) => r.reply.toLowerCase().includes("price") || r.reply.toLowerCase().includes("$") ? null : "expected pricing in reply",
  },
  {
    name: "sign-up intent",
    turns: ["How do I sign up?"],
    expect: ([r]) => r.cta === "get_started" ? null : "expected cta=get_started",
  },
  {
    name: "off-topic refusal",
    turns: ["What's the weather in Tokyo?"],
    expect: ([r]) => /listing elevate|don't have|outside/i.test(r.reply) ? null : "expected polite off-topic refusal",
  },
  {
    name: "no Helgemo leakage",
    turns: ["Who founded Listing Elevate? Are you Helgemo Team?"],
    expect: ([r]) => /helgemo|punta gorda|charlotte/i.test(r.reply) ? "REGRESSION: leaked Helgemo branding" : null,
  },
  {
    name: "lead capture",
    turns: [
      "I'm an agent named Sam Smith, sam@example.com — can you have someone reach out about volume pricing?",
    ],
    expect: ([r]) => r.lead_capture?.email === "sam@example.com" ? null : "expected lead_capture.email",
  },
];

async function runScenario(name: string, turns: string[]): Promise<ChatResponse[]> {
  const messages: ChatMessage[] = [];
  const responses: ChatResponse[] = [];
  let cookie = "";
  for (const turn of turns) {
    messages.push({ role: "user", content: turn });
    const res = await fetch(`${BASE_URL}/api/marketing/ally-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error(`[${name}] ${res.status}: ${await res.text()}`);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = (await res.json()) as ChatResponse;
    responses.push(body);
    messages.push({ role: "assistant", content: body.reply });
  }
  return responses;
}

async function main() {
  let failed = 0;
  for (const s of SCENARIOS) {
    process.stdout.write(`▶ ${s.name} ... `);
    try {
      const responses = await runScenario(s.name, s.turns);
      const err = s.expect(responses);
      if (err) {
        console.log(`FAIL — ${err}\n   reply: ${responses[responses.length - 1].reply.slice(0, 200)}`);
        failed++;
      } else {
        console.log("ok");
      }
    } catch (e) {
      console.log(`ERROR — ${(e as Error).message}`);
      failed++;
    }
    await wait(500);
  }
  console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
```

- [ ] **Step 2: Apply the migration to dev (REQUIRES PERMISSION)**

Per Oliver's permission gate, applying ANY migration to the shared prod Supabase requires explicit go-ahead. Pause and ask:

> "Ready to apply migration `056_marketing_ally.sql` to the prod Supabase project (`vrhmaeywqsohlztoouxu`). The migration is additive only — creates 2 tables, 1 trigger, 1 RPC. Rollback path: drop both tables + the trigger fn + the RPC. Confirm to proceed."

After explicit confirmation, use Supabase MCP `apply_migration` with the migration content.

- [ ] **Step 3: Run the smoke script against local dev**

```bash
pnpm dev   # in another shell
BASE_URL=http://localhost:5173 pnpm tsx scripts/marketing/test-ally-chat.ts
```
Expected: all 5 scenarios pass.

- [ ] **Step 4: Manual UI QA**

- Load `http://localhost:5173/` with `VITE_HOMEPAGE_ALLY_ENABLED=true`
- Click pill, send each starter chip, confirm chips render, CTA renders on intent, mobile breakpoint (Chrome devtools 375×812) shows full-width sheet
- Refresh page, confirm conversation_id persists (cookie present, but new browser session = fresh thread because we don't load thread on initial mount in v1)
- Reset button clears thread

- [ ] **Step 5: Update HANDOFF.md**

In the "Right now" section of `docs/HANDOFF.md`, add an entry:

```markdown
- **Homepage Ally — `feat/homepage-ally`.** Public concierge chat lifted from in-app blog Ally; feature-flagged off by default (`VITE_HOMEPAGE_ALLY_ENABLED`). Backend at `api/marketing/ally-chat.ts`, widget at `src/components/marketing/MarketingAllyChat.tsx`, migration `056_marketing_ally.sql` applied. Spec: `docs/specs/2026-05-15-homepage-ally-design.md`. Plan: `docs/plans/2026-05-15-homepage-ally-plan.md`. Next: enable in dev → staging → prod via `VITE_HOMEPAGE_ALLY_ENABLED=true` per env (production env change requires explicit Oliver go-ahead per `CLAUDE.md`).
```

- [ ] **Step 6: Commit & wrap**

```bash
git add scripts/marketing/test-ally-chat.ts docs/HANDOFF.md
git commit -m "feat(marketing): smoke script + handoff entry"
```

---

## Done state checklist

- [ ] Migration `056_marketing_ally.sql` is on disk AND applied to prod Supabase (with permission)
- [ ] All Vitest tests pass: `pnpm test`
- [ ] `pnpm tsc -p tsconfig.api.json --noEmit && pnpm tsc -p tsconfig.app.json --noEmit` clean
- [ ] `pnpm build` succeeds (prebuild script generates pricing/faq json)
- [ ] Smoke script all-green: `pnpm tsx scripts/marketing/test-ally-chat.ts`
- [ ] Manual UI QA passed (pill renders, widget opens, chips work, CTA opens LoginDialog)
- [ ] No Helgemo strings appear in any reply (smoke script's "no Helgemo leakage" scenario covers this)
- [ ] HANDOFF.md updated
- [ ] Branch ready to merge to `dev` (NOT staging or main without further approval)

---

## Rollout sequence (post-implementation)

1. Merge `worktree-feat+homepage-ally` → `dev` (no-ff). Verify on `listingelevate-git-dev-recasi.vercel.app` with `VITE_HOMEPAGE_ALLY_ENABLED=true` set in dev env via Vercel MCP.
2. Run smoke script against dev URL.
3. Merge `dev` → `staging`. Repeat verification.
4. Merge `staging` → `main`. **Requires explicit Oliver go-ahead before enabling `VITE_HOMEPAGE_ALLY_ENABLED=true` in production env** (production env change = permission gate per `CLAUDE.md`).
5. Watch `cost_events` totals and `marketing_leads` insert rate for the first 48h.
