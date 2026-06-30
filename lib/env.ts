/**
 * Runtime environment helpers for the server layer.
 *
 * Non-prod detection mirrors the write-guard pattern used throughout the codebase
 * (lib/pipeline/stuck-reaper.ts, scripts/bunny-rehost-backfill.ts, etc.):
 *
 *   "real prod" = VERCEL_ENV === "production"  OR  LE_ALLOW_NONPROD_WRITES === "true"
 *
 * `isNonProdEnv()` is the strict inverse: rows written when this returns true
 * are tagged `is_test = true` and excluded from live views + cost reconciliation.
 * LE_ALLOW_NONPROD_WRITES=true is treated as "real-data intent" (e.g. a developer
 * running a local backfill script against the shared DB), so those rows are NOT
 * marked as test data.
 */

/**
 * Returns true on Preview / dev deploys and in local environments.
 * Returns false when VERCEL_ENV=production or LE_ALLOW_NONPROD_WRITES=true.
 *
 * Use this to decide whether to tag a DB row as is_test=true, or to suppress
 * a live-data filter on non-prod so developers can see their own test rows.
 */
export function isNonProdEnv(): boolean {
  return !(
    process.env.VERCEL_ENV === "production" ||
    process.env.LE_ALLOW_NONPROD_WRITES === "true"
  );
}
