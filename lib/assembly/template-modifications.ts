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
 *   Audio-Voiceover          audio  AI voiceover URL (current template track name)
 *   Voice-Over               audio  AI voiceover URL (legacy template track name)
 *   Clip-1 … Clip-8          video  walkthrough clip URLs
 *
 * Creatomate silently ignores keys for placeholders the template doesn't have,
 * so the mapper writes the full set every time. If a future template uses
 * different names, add a new mapper.
 */

import type { AssembleVideoParams } from "../providers/shotstack.js";

/**
 * Modification dict accepted by POST /v2/renders. Values: string | number |
 * boolean | null — modifications can replace ANY RenderScript element property
 * (e.g. `Text-Address.text_wrap`), not just `.text`/`.source`. See
 * https://creatomate.com/docs/fundamentals/getting-started/template-modifications
 */
export type CreatomateModifications = Record<
  string,
  string | number | boolean | null
>;

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

/**
 * Address used for on-video DISPLAY (not voiceover/script generation):
 * strips a trailing country (", USA" / ", United States [of America]") and a
 * trailing US zip (5-digit or zip+4), then trims dangling commas/whitespace.
 *
 *   "5019 San Massimo Dr, Punta Gorda, FL 33950" → "5019 San Massimo Dr, Punta Gorda, FL"
 */
export function displayAddress(address: string | null | undefined): string {
  let s = (address ?? "").trim();
  // Trailing country first (it follows the zip when both are present).
  s = s.replace(/[,\s]*(?:USA|U\.S\.A\.|United States(?: of America)?)\.?$/i, "");
  // Trailing US zip, 5-digit or zip+4.
  s = s.replace(/\s+\d{5}(?:-\d{4})?$/, "");
  // Dangling separators left behind by the strips.
  s = s.replace(/[,\s]+$/, "");
  return s;
}

/**
 * Display addresses longer than this get the one-line auto-fit treatment
 * (see buildTemplateModifications). Calibrated from the 2026-06 prod failure:
 * "5019 San Massimo Dr, Punta Gorda, FL" (36 chars, zip already stripped)
 * wrapped to two lines on the 15s template at its designed font size.
 */
export const ADDRESS_ONE_LINE_FIT_THRESHOLD = 28;

export interface ModificationContext {
  /** Free-text full address. */
  address: string;
  /** properties.selected_package — drives the category label. */
  selectedPackage: string | null | undefined;
  /** Listing agent display name. */
  agentName: string;
  /** Brokerage name (from user_profile.brokerage or property.brokerage). */
  brokerageName: string | null | undefined;
  /**
   * Agent contact phone (user_profiles.phone) → Text-Phone-Number.text on the
   * "15 seconds - Just Listed" template. Omitted when absent so the template's
   * own default line shows rather than a blank.
   */
  agentPhone?: string | null;
  /** Ordered property clips → Clip-1.source … Clip-N.source. */
  clips?: AssembleVideoParams["clips"];
  /** Background music URL → Audio-Music.source. */
  musicUrl?: string | null;
  /** Optional agent headshot URL → Agent-Headshot-Final.source. */
  agentHeadshotUrl?: string | null;
  /**
   * AI voiceover MP3 URL → Audio-Voiceover.source (current templates) and
   * Voice-Over.source (legacy templates). When present the template swaps in
   * the generated narration track. Templates without a matching element
   * silently ignore the extra key.
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
  // The video never shows the zip code (owner request, 2026-06): strip it
  // (and any trailing country) BEFORE splitting, so City/State-Intro shows
  // "Punta Gorda, FL"-style lines, never "FL 33950".
  const fullAddress = displayAddress(ctx.address);
  const [streetLine, cityStateLine] = splitAddress(fullAddress);
  const categoryLabel = categoryLabelForPackage(ctx.selectedPackage);
  const brokerage = ctx.brokerageName ?? "";

  const mods: CreatomateModifications = {
    "St#/StName-Intro.text": streetLine,
    "City/State-Intro.text": cityStateLine,
    "Vid-Category-Intro.text": categoryLabel,
    "Listing-Agent-Mid.text": ctx.agentName,
    "Listing-Agent-Final.text": ctx.agentName,
    "Listing-Brokerage-Mid.text": brokerage,
    "Listing-Brokerage-Final.text": brokerage,
    "Full-Address-Final.text": fullAddress,
    // "15 seconds - Just Listed" (075d3024…) element names. Single-line text
    // fields; backward-compatible — Creatomate ignores keys a template lacks,
    // so #01 renders are unaffected by these extra keys.
    "Text-Agent-Name.text": ctx.agentName,
    "Text-JL.text": categoryLabel,
    "Text-Address.text": fullAddress,
    "Text-Brokerage-Team.text": brokerage,
  };

  // One-line fit for long addresses (owner request, 2026-06: the address must
  // never wrap — shrink to fit instead). Per the Creatomate RenderScript docs
  // (https://creatomate.com/docs/api/render-script/text-element):
  //   - `font_size: null` enables automatic sizing, constrained by
  //     `font_size_minimum` (default "1 vmin") / `font_size_maximum`
  //     (default "100 vmin");
  //   - `text_wrap: false` keeps the text on a single line, so the autosizer
  //     shrinks the font until that one line fits the element's box.
  // Gated by length: short addresses keep the template's designed font size
  // (autosizing them could GROW the text past the design), and templates
  // without these elements silently ignore the keys — same precedent as the
  // Voice-Over.source key above.
  if (fullAddress.length > ADDRESS_ONE_LINE_FIT_THRESHOLD) {
    for (const el of ["Text-Address", "Full-Address-Final"]) {
      mods[`${el}.font_size`] = null; // auto-size (shrink to fit)
      mods[`${el}.text_wrap`] = false; // force a single line
    }
  }

  if (ctx.agentPhone) {
    mods["Text-Phone-Number.text"] = ctx.agentPhone;
  }

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
    // 15s template uses Image-Headshot for the same asset.
    mods["Image-Headshot.source"] = ctx.agentHeadshotUrl;
  }

  if (ctx.voiceoverUrl) {
    mods["Audio-Voiceover.source"] = ctx.voiceoverUrl; // current template track name
    mods["Voice-Over.source"] = ctx.voiceoverUrl; // legacy templates
  }

  return mods;
}
