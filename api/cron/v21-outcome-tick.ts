import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 120;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional auth — if CRON_SECRET is configured, require it. Vercel cron
  // auto-sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET env is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(200).json({ skipped: true, reason: "gen2_v21_disabled" });
  }

  const start = Date.now();

  try {
    const { getSupabase } = await import("../../lib/client.js");
    const { processOutstandingOutcomes } = await import("../../lib/gen2-v21/outcome-feedback/index.js");

    const supabase = getSupabase();
    const { processed, errors } = await processOutstandingOutcomes(supabase);
    const ms = Date.now() - start;

    return res.status(200).json({ processed, errors, ms });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[v21-outcome-tick] Fatal error:", msg);
    return res.status(500).json({ error: msg });
  }
}
