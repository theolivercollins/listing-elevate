import type { SupabaseClient } from "@supabase/supabase-js";

export const LIMITS = {
  IP_PER_MIN: 5,
  IP_PER_DAY: 50,
  CONV_MAX_MESSAGES: 30,
  CONV_MAX_COST_CENTS: 100, // $1.00
  GLOBAL_PER_DAY: Number(process.env.MARKETING_ALLY_DAILY_CAP || 500),
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

  // 3. Per-conversation message count
  await bump(supabase, `conv:${conversationId}:msgs`, oneDayFromNow(now), LIMITS.CONV_MAX_MESSAGES, "conversation_messages", 0);

  // 4. Per-IP per minute (burst): counts unique conversations started by this IP per minute.
  //    We track a per-(IP, conv, minute) presence key; only on the first message of each
  //    unique conversation do we increment the IP-minute aggregate counter.
  const convPresenceKey = `ip:${ipHash}:conv:${conversationId}:min:${minuteKey}`;
  const { data: presenceCount, error: presenceErr } = await supabase.rpc("marketing_chat_rate_limit_bump", {
    p_key: convPresenceKey,
    p_expires_at: oneMinuteFromNow(now).toISOString(),
  });
  if (presenceErr) throw new Error(`rate-limit bump failed (ip_per_min presence): ${presenceErr.message}`);
  if ((presenceCount as number) === 1) {
    // First message from this (IP, conversation) pair this minute — register against IP aggregate
    await bump(supabase, `ip:${ipHash}:min:${minuteKey}`, oneMinuteFromNow(now), LIMITS.IP_PER_MIN, "ip_per_min", 60);
  }

  // 5. Per-IP per day
  await bump(supabase, `ip:${ipHash}:day:${dayKey}`, oneDayFromNow(now), LIMITS.IP_PER_DAY, "ip_per_day", 86400);
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
