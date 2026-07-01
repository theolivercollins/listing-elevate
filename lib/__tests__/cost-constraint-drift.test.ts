/**
 * cost-constraint-drift.test.ts
 *
 * Guards against the recurring class of bug where a new provider or unit_type
 * is added to the TypeScript union in lib/db.ts but the corresponding DB CHECK
 * constraint in supabase/migrations is NOT updated — causing every insert for
 * that value to hit a 23514 CHECK violation that is silently swallowed by
 * .catch() call-sites, permanently losing spend data.
 *
 * Past incidents:
 *   - Migration 032: atlas, google, higgsfield added late
 *   - Migration 045: nullable property_id caused silent drops
 *   - Migration 060: elevenlabs added late
 *   - Migration 085: bunny + veo added late (TS union was widened in ae012ba
 *     without updating the constraint; Bunny cost data was lost in prod)
 *   - Migration 089: 'characters' (ElevenLabs TTS) added late; voiceover
 *     spend was NEVER tracked in prod until this migration
 *
 * Strategy (pure static, no DB connection):
 *   1. The DB allowed-values constants below mirror the LATEST migration that
 *      redefines each CHECK constraint (cited inline). They are the single
 *      authoritative maintained mirror — update them here when you add a
 *      migration, or this test will fail.
 *   2. The TS union values are extracted from the Parameters<> of
 *      recordCostEvent (lib/db.ts). We enumerate them as const arrays here so
 *      the test can iterate them without a runtime import that would pull in
 *      Supabase/env dependencies.
 *   3. The test asserts TS ⊆ DB-allowed: every value callable from TypeScript
 *      must be accepted by the DB constraint. Values in the DB that are NOT in
 *      the TS union are fine (legacy values, kept for rollback).
 *
 * How to fix a failure:
 *   Add a new migration that drops and recreates the relevant CHECK constraint
 *   with the new value included (see 085_cost_events_bunny.sql as a template),
 *   then add the value to the corresponding DB_* constant below with the new
 *   migration filename cited.
 */

import { describe, it, expect } from "vitest";

// ─── DB-side allowed values (maintained constants) ────────────────────────────
//
// These mirror the LATEST migration that redefines each CHECK constraint.
// Update this file together with any new cost_events migration.

/**
 * Allowed `provider` values per the DB CHECK constraint.
 * Source: 102_welcome_emails.sql (the latest migration to redefine this
 * constraint as of 2026-07-01 — added 'resend' for the welcome-email send,
 * which is written via a direct cost_events insert in
 * lib/email/welcome-db.ts, NOT via recordCostEvent, so 'resend' is
 * intentionally absent from TS_PROVIDERS below).
 */
const DB_ALLOWED_PROVIDERS = new Set([
  "anthropic",
  "runway",
  "kling",
  "luma",
  "shotstack",
  "openai",
  "atlas",
  "google",
  "higgsfield",
  "browserbase",
  "apify",
  "gemini",
  "creatomate",
  "elevenlabs",
  "bunny",
  "veo",
  "resend",
] as const);

/**
 * Allowed `unit_type` values per the DB CHECK constraint.
 * Source: 089_cost_events_unit_type_characters.sql (the latest migration to
 * redefine this constraint as of 2026-06-18).
 * NOTE: NULL is allowed but not enumerated here; the test only checks non-null
 * string literals present in the TS union.
 */
const DB_ALLOWED_UNIT_TYPES = new Set([
  "tokens",
  "credits",
  "kling_units",
  "renders",
  "characters",
  "seconds",
  "minutes",
] as const);

// ─── TS-side values (mirrors lib/db.ts recordCostEvent parameter types) ───────
//
// These must match the string-literal union on:
//   recordCostEvent event.provider   (lib/db.ts line ~397)
//   recordCostEvent event.unitType   (lib/db.ts line ~399)
//
// Update these arrays whenever you widen those unions, AND add a migration.
// The test below is the forcing function — it will fail if you update TS
// without updating DB_ALLOWED_* above (and therefore without writing the
// migration).

const TS_PROVIDERS = [
  "anthropic",
  "google",
  "runway",
  "kling",
  "higgsfield",
  "shotstack",
  "creatomate",
  "openai",
  "atlas",
  "apify",
  "elevenlabs",
  "veo",
  "bunny",
] as const satisfies readonly string[];

// null is excluded — the DB CHECK allows NULL via IS NULL branch,
// and null is not a value that can hit the constraint.
const TS_UNIT_TYPES = [
  "tokens",
  "credits",
  "kling_units",
  "renders",
  "compute_units",
  "characters",
] as const satisfies readonly string[];

// ─── Known-pending drift allowlist ────────────────────────────────────────────
//
// IMPORTANT: entries here represent REAL BUGS — unit_type values that are
// emitted by production code paths but are NOT yet in the DB CHECK constraint,
// meaning that spend silently drops on every insert (23514 violation swallowed
// by .catch).  Each entry must have a comment stating:
//   - discovered date
//   - which code paths emit it
//   - what the consequence is
//   - which planned migration will fix it
//   - instruction to remove the entry once that migration lands
//
// The size-lock test below ensures this set can only grow via a deliberate
// edit + comment — a new pending entry cannot be smuggled in silently.
//
// Discovered 2026-06-19: "compute_units" is emitted by:
//   - lib/mls/scrape-realtor.ts
//   - lib/mls/scrape-redfin.ts
//   - lib/compass/scrape-listing.ts
// None of the migrations 085 or 089 added it to cost_events_unit_type_check,
// so ALL Apify/Browserbase scraping spend is currently untracked in production.
// MUST be fixed by adding "compute_units" to the constraint in the Phase-1
// provenance migration (planned migration 090).
// REMOVE "compute_units" from this set once migration 090 lands.
const KNOWN_PENDING_DRIFT = new Set<string>(["compute_units"]);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("cost_events CHECK constraint drift guard", () => {
  // Size-lock: this assertion must be updated (with a comment) whenever a new
  // known-pending entry is added.  It prevents KNOWN_PENDING_DRIFT from growing
  // without deliberate, documented intent.
  it("KNOWN_PENDING_DRIFT contains exactly the documented pending entries (size-lock)", () => {
    // If this fails, you added a value to KNOWN_PENDING_DRIFT without updating
    // this assertion — add a comment describing the new entry and bump the count.
    expect(KNOWN_PENDING_DRIFT.size).toBe(1);
    expect(KNOWN_PENDING_DRIFT.has("compute_units")).toBe(true);
  });

  describe("provider: every TS union value must be in the DB CHECK constraint", () => {
    for (const provider of TS_PROVIDERS) {
      it(`provider '${provider}' is in DB_ALLOWED_PROVIDERS (085_cost_events_bunny.sql)`, () => {
        if (!DB_ALLOWED_PROVIDERS.has(provider as never)) {
          throw new Error(
            `'${provider}' is in the TypeScript union (lib/db.ts recordCostEvent.provider) ` +
              `but NOT in the DB CHECK constraint.\n` +
              `This means every cost_event insert for provider='${provider}' silently fails ` +
              `in production (CHECK violation 23514 swallowed by .catch).\n` +
              `Fix: add a migration that drops and recreates cost_events_provider_check to ` +
              `include '${provider}', then add it to DB_ALLOWED_PROVIDERS in this file.`,
          );
        }
        expect(DB_ALLOWED_PROVIDERS.has(provider as never)).toBe(true);
      });
    }
  });

  describe("unit_type: every TS union value must be in the DB CHECK constraint or KNOWN_PENDING_DRIFT", () => {
    for (const unitType of TS_UNIT_TYPES) {
      it(`unit_type '${unitType}' is in DB_ALLOWED_UNIT_TYPES or KNOWN_PENDING_DRIFT (089_cost_events_unit_type_characters.sql)`, () => {
        const inDb = DB_ALLOWED_UNIT_TYPES.has(unitType as never);
        const knownPending = KNOWN_PENDING_DRIFT.has(unitType);
        if (!inDb && !knownPending) {
          // This is the silent-cost-loss bug class: a TS-callable value that
          // the DB constraint will reject, causing 23514 violations silently
          // swallowed by .catch, permanently losing spend data in production.
          throw new Error(
            `'${unitType}' is in the TypeScript union (lib/db.ts recordCostEvent.unitType) ` +
              `but NOT in the DB CHECK constraint.\n` +
              `This means every cost_event insert for unit_type='${unitType}' silently fails ` +
              `in production (CHECK violation 23514 swallowed by .catch).\n` +
              `Fix: add a migration that drops and recreates cost_events_unit_type_check to ` +
              `include '${unitType}', then add it to DB_ALLOWED_UNIT_TYPES in this file.\n` +
              `If the migration is planned but not yet landed, add '${unitType}' to ` +
              `KNOWN_PENDING_DRIFT with a dated comment — but fix it promptly.`,
          );
        }
        expect(inDb || knownPending).toBe(true);
      });
    }
  });

  it("TS_PROVIDERS has no duplicates (sanity)", () => {
    const unique = new Set(TS_PROVIDERS);
    expect(unique.size).toBe(TS_PROVIDERS.length);
  });

  it("TS_UNIT_TYPES has no duplicates (sanity)", () => {
    const unique = new Set(TS_UNIT_TYPES);
    expect(unique.size).toBe(TS_UNIT_TYPES.length);
  });
});
