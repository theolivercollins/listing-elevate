/**
 * scripts/bunny-rehost-backfill.ts
 *
 * Backfill: finds scene clip_url and scene_variant clip_url rows that were
 * persisted as raw provider URLs (not yet on Bunny CDN, not on Supabase
 * Storage) since today's Bunny migration deploy (~16:50 UTC 2026-06-12).
 *
 * Root cause: the HEAD-validation in poll-scenes.ts / variants.ts sent no
 * Referer header, so Bunny library 679131's referrer allow-listing returned
 * 403 on every server-side HEAD check, triggering the fallback to the raw
 * provider URL. Kling URLs are signed + expire; they must be re-hosted now
 * while they are still alive.
 *
 * Usage (dry-run — shows what would change, writes nothing):
 *   export $(grep -E '^(BUNNY_|SUPABASE_|VERCEL_ENV|LE_ALLOW_NONPROD_WRITES)' .env.local | xargs)
 *   /Users/oliverhelgemo/listing-elevate/node_modules/.bin/tsx scripts/bunny-rehost-backfill.ts
 *
 * Write mode (actually updates DB rows + records cost_events):
 *   LE_ALLOW_NONPROD_WRITES=true \
 *   /Users/oliverhelgemo/listing-elevate/node_modules/.bin/tsx scripts/bunny-rehost-backfill.ts --apply
 *
 * Environment:
 *   BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_CDN_HOSTNAME (required)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
 *   VERCEL_ENV=production  OR  LE_ALLOW_NONPROD_WRITES=true  (required for --apply)
 *
 * Respects the standard write-guard pattern: writes only in production or with
 * LE_ALLOW_NONPROD_WRITES=true.  Dry-run is always safe to run.
 */

import { createClient } from "@supabase/supabase-js";
import {
  hostVideoOnBunny,
  isBunnyConfigured,
  bunnyStreamCostCents,
  deleteBunnyVideo,
  validateBunnyMp4Url,
} from "../lib/providers/bunny-stream.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Migration deploy timestamp — filter rows updated on or after this (UTC).
// Use the full day for safety (catches rows updated anywhere on 2026-06-12).
const BACKFILL_CUTOFF = "2026-06-12T00:00:00Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function isProviderUrl(url: string): boolean {
  // Provider URLs: raw Kling (klingai.com), Atlas/Aliyun (aliyuncs.com),
  // Runway (runware), Veo (generativelanguage.googleapis.com).
  // NOT a provider URL: Bunny CDN (b-cdn.net), Supabase Storage (supabase.co/storage).
  const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME ?? "";
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (cdnHostname && h === cdnHostname) return false; // already on Bunny
    if (h.endsWith(".supabase.co")) return false;       // Supabase Storage
    if (h.endsWith(".supabase.in")) return false;       // Supabase Storage (legacy)
    return true; // raw provider URL — needs backfill
  } catch {
    return false; // malformed URL — skip
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SceneRow {
  id: string;
  property_id: string;
  scene_number: number;
  clip_url: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  scene_id: string;
  variant: string;
  clip_url: string;
  updated_at: string;
  delivery_run_id: string | null;
}

interface BackfillResult {
  table: "scenes" | "scene_variants";
  rowId: string;
  originalUrl: string;
  newUrl: string | null;
  bunnyHosted: boolean;
  costCents: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apply = process.argv.includes("--apply");
  const canWrite =
    process.env.VERCEL_ENV === "production" ||
    process.env.LE_ALLOW_NONPROD_WRITES === "true";

  if (apply && !canWrite) {
    console.error(
      "ERROR: --apply requires VERCEL_ENV=production or LE_ALLOW_NONPROD_WRITES=true",
    );
    process.exit(1);
  }

  if (!isBunnyConfigured()) {
    console.error(
      "ERROR: Bunny Stream not configured — set BUNNY_STREAM_API_KEY, " +
        "BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_CDN_HOSTNAME",
    );
    process.exit(1);
  }

  console.log(`Mode: ${apply ? "APPLY (writes DB)" : "DRY-RUN (reads only)"}`);
  console.log(`Backfill cutoff: ${BACKFILL_CUTOFF}`);
  console.log();

  const supabase = getSupabaseAdmin();
  const results: BackfillResult[] = [];

  // ── 1. scenes table ───────────────────────────────────────────────────────
  const { data: scenes, error: scenesErr } = await supabase
    .from("scenes")
    .select("id, property_id, scene_number, clip_url, updated_at")
    .not("clip_url", "is", null)
    .gte("updated_at", BACKFILL_CUTOFF);

  if (scenesErr) {
    console.error("Failed to query scenes:", scenesErr.message);
    process.exit(1);
  }

  const sceneRows = (scenes ?? []) as SceneRow[];
  const sceneProvider = sceneRows.filter((s) => isProviderUrl(s.clip_url));
  console.log(
    `scenes: ${sceneRows.length} rows since cutoff, ${sceneProvider.length} on provider URLs (need backfill)`,
  );

  for (const row of sceneProvider) {
    const result = await rehostRow({
      table: "scenes",
      rowId: row.id,
      originalUrl: row.clip_url,
      title: `${row.property_id}/clips/backfill_scene_${row.scene_number}.mp4`,
      apply,
      supabase,
      // For scenes, also write a cost_event
      writeCostEvent: apply ? {
        propertyId: row.property_id,
        sceneId: row.id,
        metadata: { scene_number: row.scene_number, source: "backfill" },
      } : null,
    });
    results.push(result);
    logResult(result);
  }

  // ── 2. scene_variants table ───────────────────────────────────────────────
  const { data: variants, error: variantsErr } = await supabase
    .from("scene_variants")
    .select("id, scene_id, variant, clip_url, updated_at, delivery_run_id")
    .not("clip_url", "is", null)
    .gte("updated_at", BACKFILL_CUTOFF);

  if (variantsErr) {
    console.error("Failed to query scene_variants:", variantsErr.message);
    process.exit(1);
  }

  const variantRows = (variants ?? []) as VariantRow[];
  const variantProvider = variantRows.filter((v) => isProviderUrl(v.clip_url));
  console.log(
    `\nscene_variants: ${variantRows.length} rows since cutoff, ${variantProvider.length} on provider URLs (need backfill)`,
  );

  for (const row of variantProvider) {
    const result = await rehostRow({
      table: "scene_variants",
      rowId: row.id,
      originalUrl: row.clip_url,
      title: `variants/backfill_scene_${row.scene_id}_${row.variant}.mp4`,
      apply,
      supabase,
      writeCostEvent: apply ? {
        propertyId: null,  // scene_variants don't have direct property_id
        sceneId: row.scene_id,
        metadata: { variant: row.variant, delivery_run_id: row.delivery_run_id, source: "backfill" },
      } : null,
    });
    results.push(result);
    logResult(result);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const succeeded = results.filter((r) => r.bunnyHosted).length;
  const failed = results.filter((r) => r.error !== null).length;
  const totalCents = results.reduce((sum, r) => sum + r.costCents, 0);

  console.log("\n─────────────────────────────────────────");
  console.log(`Total rows needing backfill:  ${results.length}`);
  console.log(`Successfully hosted on Bunny: ${succeeded}`);
  console.log(`Failures / kept provider URL: ${failed}`);
  console.log(`Total Bunny hosting cost:     ${totalCents}¢`);
  if (!apply) {
    console.log("\nRun with --apply to write changes.");
  } else {
    console.log("\nAll writes applied.");
  }
}

// ---------------------------------------------------------------------------
// rehostRow
// ---------------------------------------------------------------------------

async function rehostRow(opts: {
  table: "scenes" | "scene_variants";
  rowId: string;
  originalUrl: string;
  title: string;
  apply: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createClient<any, any, any>>;
  writeCostEvent: {
    propertyId: string | null;
    sceneId: string | null;
    metadata: Record<string, unknown>;
  } | null;
}): Promise<BackfillResult> {
  const { table, rowId, originalUrl, title, apply, supabase, writeCostEvent } = opts;

  try {
    // Download from provider URL (may be expiring — act quickly!)
    console.log(`  Downloading ${originalUrl.slice(0, 80)}…`);
    const dlRes = await fetch(originalUrl);
    if (!dlRes.ok) {
      return {
        table, rowId, originalUrl, newUrl: null, bunnyHosted: false,
        costCents: 0, error: `download ${dlRes.status}`,
      };
    }
    const buffer = Buffer.from(await dlRes.arrayBuffer());

    // Upload to Bunny Stream
    console.log(`  Uploading to Bunny (${Math.round(buffer.byteLength / 1024)}KB)…`);
    const hosted = await hostVideoOnBunny(title, buffer);

    // HEAD-validate with Referer (this is the core fix — ensures the URL is
    // actually accessible before persisting it).
    const mp4Valid = await validateBunnyMp4Url(hosted.mp4Url);
    if (!mp4Valid) {
      console.warn(`  HEAD validation failed for ${hosted.mp4Url} — cleaning up orphan`);
      deleteBunnyVideo(hosted.guid).catch(() => {});
      return {
        table, rowId, originalUrl, newUrl: null, bunnyHosted: false,
        costCents: bunnyStreamCostCents(buffer.byteLength),
        error: "HEAD validation failed",
      };
    }

    const costCents = bunnyStreamCostCents(buffer.byteLength);

    if (!apply) {
      // Dry-run: report what WOULD happen but write nothing.
      // The Bunny object was already uploaded above (to confirm hosting succeeds),
      // so we must delete it now — otherwise every dry-run row creates a real,
      // billable, persistent orphan in Bunny. Best-effort; non-fatal on failure.
      deleteBunnyVideo(hosted.guid).catch(() => {});
      return {
        table, rowId, originalUrl, newUrl: hosted.mp4Url,
        bunnyHosted: true, costCents, error: null,
      };
    }

    // Update the DB row
    const { error: updateErr } = await (table === "scenes"
      ? supabase.from("scenes").update({ clip_url: hosted.mp4Url }).eq("id", rowId)
      : supabase.from("scene_variants").update({ clip_url: hosted.mp4Url }).eq("id", rowId));

    if (updateErr) {
      // Upload succeeded but DB update failed — delete the Bunny object to
      // avoid a dangling orphan (the original provider URL stays in the DB).
      deleteBunnyVideo(hosted.guid).catch(() => {});
      return {
        table, rowId, originalUrl, newUrl: hosted.mp4Url, bunnyHosted: false,
        costCents, error: `db update: ${updateErr.message}`,
      };
    }

    // Record cost_event
    if (writeCostEvent) {
      const { propertyId, sceneId, metadata } = writeCostEvent;
      const { error: costErr } = await supabase.from("cost_events").insert({
        property_id: propertyId,
        scene_id: sceneId,
        stage: "generation",
        provider: "bunny",
        units_consumed: 1,
        unit_type: "renders",
        cost_cents: costCents,
        metadata: { bunny_hosted: true, ...metadata },
      });
      if (costErr) {
        console.warn(`  cost_event insert failed (non-fatal): ${costErr.message}`);
      }
    }

    return {
      table, rowId, originalUrl, newUrl: hosted.mp4Url,
      bunnyHosted: true, costCents, error: null,
    };
  } catch (err) {
    return {
      table, rowId, originalUrl, newUrl: null, bunnyHosted: false,
      costCents: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function logResult(r: BackfillResult) {
  const status = r.error
    ? `ERROR: ${r.error}`
    : r.bunnyHosted
      ? `OK → ${r.newUrl?.slice(0, 60)}…`
      : `DRY-RUN (would host)`;
  console.log(`  [${r.table}/${r.rowId.slice(0, 8)}] ${status}`);
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e);
  process.exit(1);
});
