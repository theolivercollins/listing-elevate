import type { SupabaseClient } from "@supabase/supabase-js";

export interface MarketingFlags {
  kill_switch: boolean;
  kill_reason: string | null;
  daily_cap_cents: number;
  updated_at: string;
}

const SINGLETON_ID = "singleton";
const DEFAULT_DAILY_CAP_CENTS = 2000;

function defaults(): MarketingFlags {
  return {
    kill_switch: false,
    kill_reason: null,
    daily_cap_cents: DEFAULT_DAILY_CAP_CENTS,
    updated_at: new Date(0).toISOString(),
  };
}

// Read-only flag read. Returns safe defaults on missing row or read error so
// transient DB issues never blackhole the chat endpoint.
export async function readMarketingFlags(supabase: SupabaseClient): Promise<MarketingFlags> {
  try {
    const { data, error } = await supabase
      .from("marketing_flags")
      .select("kill_switch, kill_reason, daily_cap_cents, updated_at")
      .eq("id", SINGLETON_ID)
      .maybeSingle();
    if (error) {
      console.error("readMarketingFlags failed:", error.message);
      return defaults();
    }
    return (data as MarketingFlags | null) ?? defaults();
  } catch (err) {
    console.error("readMarketingFlags exception:", (err as Error).message);
    return defaults();
  }
}

export async function setKillSwitch(
  supabase: SupabaseClient,
  on: boolean,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("marketing_flags")
    .update({
      kill_switch: on,
      kill_reason: on ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", SINGLETON_ID);
  if (error) throw new Error(`setKillSwitch failed: ${error.message}`);
}
