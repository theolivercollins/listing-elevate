/**
 * Map Listing Elevate property data → Creatomate template modifications.
 *
 * Each template the user designs in Creatomate exposes named placeholders.
 * Naming convention as of 2026-05-14 (template "Just Listed #01" rev 2):
 *
 *   St#/StName-Intro         text   street line (split on last comma)
 *   City/State-Intro         text   city/state line
 *   Vid-Category-Intro       text   package label ("Just Listed")
 *   Listing-Agent-Mid        text   agent display name (mid-roll)
 *   Listing-Agent-Final      text   agent display name (closing card)
 *   Listing-Brokerage-Mid    text   brokerage (mid-roll)
 *   Listing-Brokerage-Final  text   brokerage (closing card)
 *   Full-Address-Final       text   "street, city, state" full address
 *   CTA-Final                text   call-to-action — left as template default
 *   Agent-Headshot-Final     image  agent headshot — left as template default
 *                                   until user_profiles.headshot_url exists
 *   Audio-Music              audio  background music URL
 *   Clip-1 … Clip-8          video  walkthrough clip URLs
 *
 * Live "just listed 15s" template (id 075d3024-b727-4dde-bdc1-cd15a4929882)
 * uses a different naming convention — we send BOTH sets; Creatomate ignores
 * keys for placeholders the template doesn't have:
 *
 *   Text-Agent-Name          text   agent display name
 *   Text-Phone-Number        text   agent phone number
 *   Text-Address             text   full address
 *   Text-Brokerage-Team      text   brokerage name
 *   Image-Headshot           image  agent headshot
 *   Clip-1 … Clip-5          video  walkthrough clips (already work)
 *
 * Creatomate silently ignores keys for placeholders the template doesn't have,
 * so the mapper writes the full set every time. If a future template uses
 * different names, add a new mapper.
 */

import type { AssembleVideoParams } from "../providers/shotstack.js";

/** Modification dict accepted by POST /v2/renders. Values: string | number | null. */
export type CreatomateModifications = Record<string, string | number | null>;

/** Map our internal package keys to the label that goes onto the title card. */
const PACKAGE_LABELS: Record<string, string> = {
  just_listed: "Just Listed",
  just_pended: "Just Pended",
  just_closed: "Just Closed",
  life_cycle: "Just Listed",
};

export function categoryLabelForPackage(pkg: string | null | undefined): string {
  if (pkg && PACKAGE_LABELS[pkg]) return PACKAGE_LABELS[pkg];
  return "Just Listed";
}

/**
 * Split a free-text address into street line + city/state line.
 * Convention: split on the LAST comma.
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
  /** Free-text full address. */
  address: string;
  /** properties.selected_package — drives the category label. */
  selectedPackage: string | null | undefined;
  /** Listing agent display name. */
  agentName: string;
  /** Brokerage name (from user_profile.brokerage or property.brokerage). */
  brokerageName: string | null | undefined;
  /** Ordered property clips → Clip-1.source … Clip-N.source. */
  clips?: AssembleVideoParams["clips"];
  /** Background music URL → Audio-Music.source. */
  musicUrl?: string | null;
  /** Optional agent headshot URL → Agent-Headshot-Final.source + Image-Headshot.source. */
  agentHeadshotUrl?: string | null;
  /** Agent phone number → Text-Phone-Number.text (live 15s template). */
  agentPhone?: string | null;
  /**
   * AI voiceover MP3 URL → Voice-Over.source.
   * When present the template swaps in the generated narration track.
   * Templates without a Voice-Over element silently ignore this key.
   */
  voiceoverUrl?: string | null;
}

/**
 * Build the modifications dict for POST /v2/renders. Writes every known
 * placeholder; Creatomate drops keys it doesn't recognize.
 */
export function buildTemplateModifications(
  ctx: ModificationContext,
): CreatomateModifications {
  const [streetLine, cityStateLine] = splitAddress(ctx.address);
  const categoryLabel = categoryLabelForPackage(ctx.selectedPackage);
  const brokerage = ctx.brokerageName ?? "";
  const fullAddress = ctx.address?.trim() ?? "";

  const mods: CreatomateModifications = {
    // Legacy "Just Listed #01 rev 2" placeholder names — kept for back-compat.
    "St#/StName-Intro.text": streetLine,
    "City/State-Intro.text": cityStateLine,
    "Vid-Category-Intro.text": categoryLabel,
    "Listing-Agent-Mid.text": ctx.agentName,
    "Listing-Agent-Final.text": ctx.agentName,
    "Listing-Brokerage-Mid.text": brokerage,
    "Listing-Brokerage-Final.text": brokerage,
    "Full-Address-Final.text": fullAddress,
    // Live "just listed 15s" template (075d3024-b727-4dde-bdc1-cd15a4929882)
    // element names — Creatomate silently ignores these on templates that don't
    // have them, so it's safe to send both sets on every render.
    "Text-Agent-Name.text": ctx.agentName,
    "Text-Phone-Number.text": ctx.agentPhone ?? "",
    "Text-Address.text": fullAddress,
    "Text-Brokerage-Team.text": brokerage,
  };

  if (ctx.clips && ctx.clips.length > 0) {
    ctx.clips.forEach((clip, i) => {
      const slot = `Clip-${i + 1}`;
      mods[`${slot}.source`] = clip.url;
      mods[`${slot}.duration`] = clip.durationSeconds;
    });
  }

  if (ctx.musicUrl) {
    mods["Audio-Music.source"] = ctx.musicUrl;
  }

  if (ctx.agentHeadshotUrl) {
    mods["Agent-Headshot-Final.source"] = ctx.agentHeadshotUrl;
    // Live 15s template element name:
    mods["Image-Headshot.source"] = ctx.agentHeadshotUrl;
  }

  if (ctx.voiceoverUrl) {
    mods["Voice-Over.source"] = ctx.voiceoverUrl;
  }

  return mods;
}
