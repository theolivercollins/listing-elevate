// Pipeline-run idempotency claim.
//
// Why this exists: two `runPipeline(propertyId)` invocations racing in
// parallel for the same property duplicated everything on the 13fe5a96 rerun
// (2026-05-18). The Re-run UI fires `triggerPipeline` as a fire-and-forget
// fetch; any duplicate POST (browser retry, ⌐double-click, second tab) lands
// a second runPipeline before the property status flips off "queued".
//
// The fix: at the very top of runPipeline, atomically transition
//   status='queued'|'failed'|'needs_review' → status='analyzing' (and stamp
//   pipeline_started_at). If 0 rows match, someone else already claimed the
// run and we exit immediately. PostgreSQL gives us the atomicity here —
// rows can only update once before the IN-filter no longer matches.

import type { SupabaseClient } from "@supabase/supabase-js";

// The set of statuses a property must be in for runPipeline to take the run.
// Anything else (analyzing/scripting/generating/assembling/complete) means
// a pipeline is in flight or already finished, so the claim must fail.
const CLAIMABLE_STATUSES = ["queued", "failed", "needs_review"] as const;

export async function tryClaimPipelineRun(
  supabase: Pick<SupabaseClient, "from">,
  propertyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("properties")
    .update({
      status: "analyzing",
      pipeline_started_at: new Date().toISOString(),
    })
    .eq("id", propertyId)
    .in("status", CLAIMABLE_STATUSES as unknown as string[])
    .select("id");
  return Array.isArray(data) && data.length > 0;
}
