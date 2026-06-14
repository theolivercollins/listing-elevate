import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../lib/client.js";
import { analyzeListingPhotos, directListingScenes } from "../../lib/prompt-lab-listings.js";
import { reapStuckLabListings } from "../../lib/pipeline/stuck-reaper.js";

// Vercel serverless kills the function lambda as soon as the POST
// response is written, so the fire-and-forget chain in the create
// endpoint never completes. This cron advances listings through their
// lifecycle on a reliable tick: picks up 'analyzing' rows, runs the
// analyzer, flips to 'directing'; picks up 'directing' rows, runs the
// director, flips to 'ready_to_render'. Failures mark the listing
// 'failed' so the UI stops spinning.
//
// Budget: Vercel Pro caps maxDuration at 300s. Analyze is the expensive
// step (one Claude vision call per photo, parallelized); director is a
// single Claude call. Process up to 3 analyzing + 5 directing per tick
// to stay within budget even on large listings.
export const maxDuration = 300;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();

  // Reap listings stuck in 'analyzing' or 'directing' before the main polling work.
  // A reaper failure must never break the cron — errors are logged inside.
  try {
    await reapStuckLabListings(supabase);
  } catch (reaperErr) {
    console.error("[poll-listing-lifecycle] reaper threw unexpectedly:", reaperErr);
  }

  const { data: analyzing } = await supabase
    .from("prompt_lab_listings")
    .select("id")
    .eq("status", "analyzing")
    .eq("archived", false)
    .order("created_at", { ascending: true })
    .limit(3);

  let analyzed = 0;
  let analyzeFailed = 0;
  for (const l of analyzing ?? []) {
    try {
      await analyzeListingPhotos(l.id);
      analyzed += 1;
    } catch (err) {
      console.error(`[listing-lifecycle] analyze ${l.id}:`, err);
      await supabase
        .from("prompt_lab_listings")
        .update({ status: "failed" })
        .eq("id", l.id);
      analyzeFailed += 1;
    }
  }

  const { data: directing } = await supabase
    .from("prompt_lab_listings")
    .select("id")
    .eq("status", "directing")
    .eq("archived", false)
    .order("created_at", { ascending: true })
    .limit(5);

  let directed = 0;
  let directFailed = 0;
  for (const l of directing ?? []) {
    try {
      await directListingScenes(l.id);
      directed += 1;
    } catch (err) {
      console.error(`[listing-lifecycle] direct ${l.id}:`, err);
      await supabase
        .from("prompt_lab_listings")
        .update({ status: "failed" })
        .eq("id", l.id);
      directFailed += 1;
    }
  }

  return res.status(200).json({
    analyzed,
    analyze_failed: analyzeFailed,
    directed,
    direct_failed: directFailed,
  });
}
