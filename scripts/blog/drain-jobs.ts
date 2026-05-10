// scripts/blog/drain-jobs.ts
//
// Loop tick() until the queue is empty (or we hit the safety cap). Useful for
// smoke-testing — production uses the per-minute cron poller.

import "dotenv/config";
import { getSupabase } from "../../lib/client.js";
import { tick } from "../../lib/blog-engine/jobs/runner.js";
import { handlers } from "../../lib/blog-engine/jobs/handlers/index.js";

const BATCH = Number(process.env.DRAIN_BATCH ?? 10);
const MAX_TICKS = Number(process.env.DRAIN_MAX_TICKS ?? 50);

async function main() {
  const supabase = getSupabase();
  let total = 0;
  for (let i = 1; i <= MAX_TICKS; i++) {
    const out = await tick(supabase, handlers, BATCH);
    total += out.processed;
    console.log(`tick ${i}: processed ${out.processed} (total ${total})`);
    if (out.processed === 0) break;
  }
  console.log(`drain complete. total processed = ${total}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
