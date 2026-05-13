// lib/blog-engine/publishers/sierra/auth.ts
import type { Page } from "playwright-core";
import { SIERRA_PATHS, SIERRA_SELECTORS } from "./selectors.js";

export interface SierraCreds {
  siteName: string;     // e.g. "thehelgemoteam.com" — Sierra's third login field
  username: string;
  password: string;
}

export async function ensureSignedIn(
  page: Page,
  baseUrl: string,
  creds: SierraCreds,
): Promise<void> {
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });

  const onLogin = page.url().toLowerCase().includes("login");
  if (!onLogin) return;

  // Wait for the login form to actually render. domcontentloaded fires before
  // ASP.NET WebForms finishes wiring up the form, which made the first replay
  // look "too short" — we were poking at half-rendered DOM.
  await page.waitForSelector(SIERRA_SELECTORS.loginSiteNameInput, { timeout: 15_000 });

  await page.fill(SIERRA_SELECTORS.loginSiteNameInput, creds.siteName);
  await page.fill(SIERRA_SELECTORS.loginUsernameInput, creds.username);
  await page.fill(SIERRA_SELECTORS.loginPasswordInput, creds.password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.click(SIERRA_SELECTORS.loginSubmitButton),
  ]);

  // Give Sierra a moment to finish any post-login redirect / cookie set.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes("login")) {
    throw new Error(
      "Sierra login did not stick — site name / username / password wrong, or 2FA enabled?",
    );
  }
}
