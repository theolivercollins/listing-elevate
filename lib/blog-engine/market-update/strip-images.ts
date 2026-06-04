// Pure: remove image assets from filled HTML for text/data-only regions
// (The Isles + Deep Creek per the spec). Charlotte County keeps its imagery.

/**
 * Strip <img> tags, <picture> blocks, and explicit <!-- MU:IMAGE ... --> markers.
 * Leaves all other markup untouched.
 */
export function stripImages(html: string): string {
  return html
    // <picture>...</picture> (with any nested sources/img)
    .replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, "")
    // standalone <img ...> (void element, optionally self-closed)
    .replace(/<img\b[^>]*?\/?>/gi, "")
    // <figure> wrappers that exist only to hold an image marker
    .replace(/<!--\s*MU:IMAGE[\s\S]*?-->/gi, "")
    // collapse the empty <figure></figure> a stripped img may leave behind
    .replace(/<figure\b[^>]*>\s*<\/figure>/gi, "");
}
