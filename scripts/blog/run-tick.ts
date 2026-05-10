// scripts/blog/run-tick.ts
//
// Local driver — runs one tick of the blog job runner against the queued jobs.
// In production, the same code paths run from api/cron/poll-blog-jobs.ts every
// minute. This script just lets us drive smoke tests without waiting for cron.

import "dotenv/config";
import { getSupabase } from "../../lib/client.js";
import { tick } from "../../lib/blog-engine/jobs/runner.js";
import { handlers } from "../../lib/blog-engine/jobs/handlers/index.js";

async function main() {
  const supabase = getSupabase();
  const out = await tick(supabase, handlers, 5);
  console.log("tick processed", out.processed, "job(s)");
}
main().catch((e) => { console.error(e); process.exit(1); });
