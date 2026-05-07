// lib/blog-engine/publishers/sierra/taxonomy.ts
import type { Page } from 'playwright-core';
import type { TaxonomyOption } from '../../types';
import type { TaxonomyResult } from '../types';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export async function fetchTaxonomy(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
): Promise<TaxonomyResult> {
  await ensureSignedIn(page, baseUrl, username, password);

  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  await page.click(SIERRA_SELECTORS.createPostButton);
  await page.waitForSelector(SIERRA_SELECTORS.titleInput);

  const authors = await readSelectOptions(page, SIERRA_SELECTORS.authorSelect);
  const categories = await readSelectOptions(page, SIERRA_SELECTORS.categorySelect);

  return { authors, categories };
}

async function readSelectOptions(page: Page, selector: string): Promise<TaxonomyOption[]> {
  return page.$$eval(`${selector} option`, (opts) =>
    (opts as HTMLOptionElement[])
      .filter(o => o.value && o.value !== '0')
      .map(o => ({ id: o.value, label: o.textContent?.trim() ?? '' })),
  );
}
