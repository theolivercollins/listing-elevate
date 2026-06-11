// T7 final-gate mount check (2026-05-28 blank-screen lesson):
// load /preview/<fake-token> from the BUILT bundle in headless Chromium and
// assert the page renders non-blank. The styled 404/expired state counts as a
// render; a blank #root (bundle crash) fails.
//
// Usage: npx vite preview --port 4173 &  then  node scripts/visual-verify/preview-mount-check.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:4173";
// Well-formed per isWellFormedToken (/^[A-Za-z0-9_-]{32}$/) but nonexistent.
const FAKE_TOKEN = "T7faketoken_T7faketoken_T7faketo";
const OUT = "/tmp/le-visual/preview-mount-check.png";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

// vite preview has no /api — its SPA fallback would answer 200/HTML. Stub the
// API route to a real 404 so the bundle's actual not-found path is exercised.
await page.route("**/api/preview/**", (route) =>
  route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' }),
);

await page.goto(`${BASE}/preview/${FAKE_TOKEN}`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2000); // allow the API-fetch failure path to settle into its rendered state

const probe = await page.evaluate(() => {
  const root = document.getElementById("root");
  return {
    rootChildCount: root?.children.length ?? 0,
    rootHtmlLength: root?.innerHTML.length ?? 0,
    bodyText: (document.body.innerText || "").trim().slice(0, 400),
  };
});
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();

console.log("probe:", JSON.stringify(probe, null, 2));
console.log("pageErrors:", pageErrors.length ? pageErrors : "(none)");
console.log("screenshot:", OUT);

const nonBlank = probe.rootChildCount > 0 && probe.bodyText.length > 0;
if (!nonBlank) {
  console.error("FAIL: /preview/<fake-token> rendered blank from the built bundle");
  process.exit(1);
}
console.log("PASS: non-blank render of built bundle at /preview/<fake-token>");
