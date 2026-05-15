// lib/blog-engine/publishers/sierra/unpublish.ts
import type { Page } from "playwright-core";
import { SIERRA_PATHS } from "./selectors.js";
import { ensureSignedIn, type SierraCreds } from "./auth.js";

export interface SierraUnpublishInput {
  baseUrl: string;
  creds: SierraCreds;
  externalPostId: string;
  postTitle: string | null;
}

export interface SierraUnpublishResult {
  removed: boolean;
}

/**
 * Removes a post from Sierra's blog manager. Sierra's blog-manager.aspx renders a
 * table of posts, each row with Edit / Delete links. The Delete link triggers a
 * JS confirm() dialog and an ASP.NET postback. We auto-accept the dialog and
 * wait for the table to refresh.
 *
 * The post is identified by externalPostId (matched against the row's Edit-link
 * href). Title is a fallback in case Sierra ever renders the id differently.
 */
export async function sierraUnpublish(
  page: Page,
  input: SierraUnpublishInput,
): Promise<SierraUnpublishResult> {
  const { baseUrl, creds, externalPostId, postTitle } = input;
  await ensureSignedIn(page, baseUrl, creds);
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });

  // Auto-accept the JS confirm() that Sierra's Delete link fires.
  page.on("dialog", (d) => d.accept().catch(() => {}));

  // Prefer the row whose Edit link references this externalPostId.
  const rowByIdSelector = `tr:has(a[href*="id=${externalPostId}"])`;
  let row = page.locator(rowByIdSelector).first();

  if ((await row.count()) === 0 && postTitle) {
    // Fallback: locate by title text inside a row.
    row = page.locator(`tr:has(a:has-text(${JSON.stringify(postTitle)}))`).first();
  }

  if ((await row.count()) === 0) {
    // Nothing to remove — treat as already-gone (idempotent).
    return { removed: false };
  }

  const deleteLink = row.locator([
    'a:has-text("Delete")',
    'a[onclick*="confirm" i]',
    'input[type="image"][alt*="delete" i]',
    'a[title*="delete" i]',
  ].join(", ")).first();

  if ((await deleteLink.count()) === 0) {
    throw new Error(`Sierra delete link not found on row for post ${externalPostId}`);
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    deleteLink.click(),
  ]);
  // Sierra sometimes does a second postback before the table re-renders.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Confirm the row is gone.
  const stillThere = await page.locator(rowByIdSelector).count();
  return { removed: stillThere === 0 };
}
