// lib/blog-engine/publishers/sierra/auth.ts
import type { Page } from 'playwright-core';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';

export async function ensureSignedIn(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });

  const onLogin = page.url().toLowerCase().includes('login');
  if (!onLogin) return;

  await page.fill(SIERRA_SELECTORS.loginUsernameInput, username);
  await page.fill(SIERRA_SELECTORS.loginPasswordInput, password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.loginSubmitButton),
  ]);

  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  if (page.url().toLowerCase().includes('login')) {
    throw new Error('Sierra login did not stick — credentials wrong or 2FA enabled?');
  }
}
