// lib/blog-engine/publishers/sierra/taxonomy.ts
import type { Locator, Page } from "playwright-core";
import type { TaxonomyOption } from "../../types";
import type { TaxonomyResult } from "../types";
import { SIERRA_PATHS, SIERRA_SELECTORS } from "./selectors";
import { ensureSignedIn, type SierraCreds } from "./auth";
import { inputByLabelText, selectByLabelText } from "./dom-helpers";

export async function fetchTaxonomy(
  page: Page,
  baseUrl: string,
  creds: SierraCreds,
): Promise<TaxonomyResult> {
  await ensureSignedIn(page, baseUrl, creds);

  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
  await page.click(SIERRA_SELECTORS.createPostButton);

  await inputByLabelText(page, "Post Title").waitFor({ timeout: 30_000 });

  const authorsLocator = selectByLabelText(page, "Author");
  const categoriesLocator = selectByLabelText(page, "Category");

  const authors = (await authorsLocator.count())
    ? await readSelectOptionsByLocator(authorsLocator)
    : [];
  const categories = (await categoriesLocator.count())
    ? await readSelectOptionsByLocator(categoriesLocator)
    : [];

  return { authors, categories };
}

async function readSelectOptionsByLocator(locator: Locator): Promise<TaxonomyOption[]> {
  return locator.evaluate((el) => {
    if (!(el instanceof HTMLSelectElement)) return [];
    return Array.from(el.options)
      .filter((o) => o.value && o.value !== "0")
      .map((o) => ({ id: o.value, label: o.textContent?.trim() ?? "" }));
  });
}
