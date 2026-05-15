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
