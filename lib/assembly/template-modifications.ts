/**
 * Map Listing Elevate property data → Creatomate template modifications.
 *
 * Each template the user designs in Creatomate exposes named placeholders.
 * Naming convention as of 2026-05-13 (template "Just Listed #01"):
 *
 *   St#/StName            text  street address line ("123 Waymay Dr")
 *   St#/StName-JSJ        text  city/state line ("Punta Gorda, FL")
 *   Vid-Category/Title    text  package label ("Just Listed")
 *   Listing-Agent         text  agent display name
 *   Listing-Agent-NWH     text  brokerage name
 *
 * Future templates may add: Clip-1.source, Clip-2.source, ..., LogoImage.source,
 * MusicTrack.source. The mapper writes those when the AssembleVideoParams
 * carry the data; the template will ignore keys for placeholders it doesn't
 * have (Creatomate silently drops unknown modification keys).
 */

import type { AssembleVideoParams } from "../providers/shotstack.js";

/** Modification dict accepted by POST /v2/renders. Values: string | number | null. */
export type CreatomateModifications = Record<string, string | number | null>;

/** Map our internal package keys to the label that goes onto the title card. */
const PACKAGE_LABELS: Record<string, string> = {
  just_listed: "Just Listed",
  just_pended: "Just Pended",
  just_closed: "Just Closed",
  life_cycle: "Just Listed", // first phase of the life-cycle campaign
};

export function categoryLabelForPackage(pkg: string | null | undefined): string {
  if (pkg && PACKAGE_LABELS[pkg]) return PACKAGE_LABELS[pkg];
  return "Just Listed";
}

/**
 * Split a free-text address into street line + city/state line.
 * Convention: split on the LAST comma. Everything before = street, after = city/state.
 *
 *   "123 Waymay Dr, Punta Gorda FL"  -> ["123 Waymay Dr", "Punta Gorda FL"]
 *   "123 Waymay Dr, Punta Gorda, FL" -> ["123 Waymay Dr, Punta Gorda", "FL"]   (multi-comma)
 *   "123 Waymay Dr"                  -> ["123 Waymay Dr", ""]
 *   ""                               -> ["", ""]
 *
 * If the user's address format has multiple commas (e.g. "123 Main St, Apt 4, Punta Gorda FL")
 * the last comma is still the right split — that puts the city/state on line 2 and
 * everything else on line 1. Good enough until we add structured address columns.
 */
export function splitAddress(address: string | null | undefined): [string, string] {
  const trimmed = (address ?? "").trim();
  if (!trimmed) return ["", ""];
  const lastCommaIdx = trimmed.lastIndexOf(",");
  if (lastCommaIdx < 0) return [trimmed, ""];
  const street = trimmed.slice(0, lastCommaIdx).trim();
  const cityState = trimmed.slice(lastCommaIdx + 1).trim();
  return [street, cityState];
}

export interface ModificationContext {
  /** Free-text full address. Will be split on last comma. */
  address: string;
  /** properties.selected_package — drives the category label. */
  selectedPackage: string | null | undefined;
  /** Listing agent display name. */
  agentName: string;
  /** Brokerage name (from user_profile.brokerage or property.brokerage). */
  brokerageName: string | null | undefined;
  /** Ordered property clips. Maps to Clip-1.source, Clip-2.source, ... when
   *  the chosen template has clip slots. Templates without those keys ignore
   *  them. Convention matches the Just Listed #01 template (2026-05-13). */
  clips?: AssembleVideoParams["clips"];
  /** Optional brokerage logo URL — drives LogoImage.source. */
  logoUrl?: string | null;
  /** Optional background music URL — drives MusicTrack.source. */
  musicUrl?: string | null;
}

/**
 * Build the modifications dict for POST /v2/renders.
 * Always writes the 5 known text fields. Conditionally writes clip / logo /
 * music slots when the caller provides them — templates that don't have
 * those placeholders ignore the extra keys.
 */
export function buildTemplateModifications(
  ctx: ModificationContext,
): CreatomateModifications {
  const [streetLine, cityStateLine] = splitAddress(ctx.address);
  const categoryLabel = categoryLabelForPackage(ctx.selectedPackage);

  // Combine agent + brokerage onto the single Listing-Agent line so they
  // sit centered together. Brokerage's own slot is intentionally emptied
  // to avoid duplicating the name. Per Oliver 2026-05-13.
  const combinedAgentLine = ctx.brokerageName
    ? `${ctx.agentName} | ${ctx.brokerageName}`
    : ctx.agentName;

  const mods: CreatomateModifications = {
    "St#/StName.text": streetLine,
    "St#/StName-JSJ.text": cityStateLine,
    "Vid-Category/Title.text": categoryLabel,
    "Listing-Agent.text": combinedAgentLine,
    "Listing-Agent-NWH.text": "",
  };

  // Clip slots: write Clip-1.source, Clip-2.source, ... when the template
  // has them. The hyphen matches the Just Listed #01 template's element
  // naming (verified via curl 2026-05-13).
  if (ctx.clips && ctx.clips.length > 0) {
    ctx.clips.forEach((clip, i) => {
      const slot = `Clip-${i + 1}`;
      mods[`${slot}.source`] = clip.url;
      mods[`${slot}.duration`] = clip.durationSeconds;
    });
  }

  if (ctx.logoUrl) {
    mods["LogoImage.source"] = ctx.logoUrl;
  }
  if (ctx.musicUrl) {
    mods["MusicTrack.source"] = ctx.musicUrl;
  }

  return mods;
}
