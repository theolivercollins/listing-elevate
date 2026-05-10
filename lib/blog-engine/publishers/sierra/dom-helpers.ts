// lib/blog-engine/publishers/sierra/dom-helpers.ts
//
// Sierra's blog admin is a modern SPA — labels are styled <div>s rather than
// real <label for="..."> associations, so Playwright's getByLabel() fails.
// These helpers find a form control by its visible label text then walk to
// the nearest following input/select/textarea in document order.

import type { Locator, Page } from "playwright-core";

/**
 * Find the LEAF-MOST element containing the label text (i.e. the label-text
 * holder, not its outer container), then walk to the next form control in
 * document order. This avoids matching ancestor divs that contain BOTH a
 * label and the form area, which would otherwise return the wrong control.
 *
 * Matches "Post Title" against either "Post Title" or "Post Title*" (Sierra
 * marks required fields with a trailing asterisk).
 */
function leafLabelXPath(label: string): string {
  const escaped = label.replace(/"/g, '\\"');
  // Match an element whose ENTIRE normalized text is exactly the label (with
  // or without Sierra's "*" required-marker suffix). Using normalize-space(.)
  // = "X" (rather than contains) avoids matching ancestor containers that
  // hold many fields, and rejects accidental substring hits ("Categories" in
  // a sidebar nav, etc.).
  return `//*[(normalize-space(.) = "${escaped}" or normalize-space(.) = "${escaped}*")]`;
}

export function inputByLabelText(page: Page, label: string): Locator {
  return page
    .locator(`xpath=${leafLabelXPath(label)}/following::*[self::input or self::textarea][1]`)
    .first();
}

export function selectByLabelText(page: Page, label: string): Locator {
  return page.locator(`xpath=${leafLabelXPath(label)}/following::select[1]`).first();
}
