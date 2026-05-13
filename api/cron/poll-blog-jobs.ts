import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 120;

import { getSupabase } from "../../lib/client.js";
import { tick } from "../../lib/blog-engine/jobs/runner.js";
import { handlers } from "../../lib/blog-engine/jobs/handlers/index.js";

// Per-tick cap. Anything over waits for next minute.
const PER_TICK_LIMIT = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional auth — if CRON_SECRET is configured, require it. Otherwise allow
  // (matches the other crons in this repo). Vercel cron auto-sends
  // `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET env is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }
  if (process.env.VERCEL_ENV !== "production") {
    return res.status(200).json({ ok: true, skipped: "non-prod" });
  }

  const supabase = getSupabase();
  const out = await tick(supabase, handlers, PER_TICK_LIMIT);
  return res.status(200).json({ ok: true, ...out });
}
