// Pure deterministic template fill: replace every {{TOKEN}} from a token map.
// Reports any {{...}} tokens it could not resolve, so the caller can block on them.

import { allTokenNames, PASSTHROUGH_TOKENS } from "./types.js";

const TOKEN_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export interface FillResult {
  html: string;
  /** Tokens present in the template that are NOT in the canonical vocabulary. */
  unknownTokens: string[];
  /** Canonical tokens present in the template whose value was empty. */
  emptyTokens: string[];
}

/** Replace all {{TOKEN}} occurrences in `templateHtml` using `tokenMap`. */
export function fillTemplate(
  templateHtml: string,
  tokenMap: Record<string, string>,
): FillResult {
  const vocab = new Set(allTokenNames());
  const unknown = new Set<string>();
  const empty = new Set<string>();

  const html = templateHtml.replace(TOKEN_RE, (match, name: string) => {
    if (PASSTHROUGH_TOKENS.has(name)) {
      return match; // downstream system substitutes these; leave untouched
    }
    if (!vocab.has(name)) {
      unknown.add(name);
      return match; // leave unknown tokens visible so they're caught downstream
    }
    const value = tokenMap[name];
    if (value === undefined || value === "") {
      empty.add(name);
      return "";
    }
    return value;
  });

  return {
    html,
    unknownTokens: [...unknown],
    emptyTokens: [...empty],
  };
}

/** List the distinct token names referenced by a template (for editor validation). */
export function tokensInTemplate(templateHtml: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(templateHtml)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}
