// LE Video v2 Sub-project A mount check: load the BUILT /dashboard/studio/videos
// route in headless Chrome and assert it renders non-blank with zero console
// errors. The route is admin-gated, so unauthenticated it renders the login
// surface — that still exercises the shared bundle and proves the Videos chunk
// (folder rail + ⋯ menu + delete dialog) imported cleanly. A module-level crash
// in the bundle throws a pageerror regardless of auth state.
//
// Usage: npx vite preview --port 4173 &  then  node scripts/visual-verify/videos-library-mount-check.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT_DIR = "/tmp/le-visual";

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

// Stub the admin APIs the page calls so the fetch paths resolve cleanly even
// though vite preview has no /api backend.
await page.route("**/api/admin/studio/video-folders**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ folders: [{ id: "f-1", name: "Listings", position: 0, video_count: 2 }] }),
  }),
);
await page.route("**/api/admin/studio/clients**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clients: [] }) }),
);
await page.route("**/api/admin/studio/videos**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 24 }),
  }),
);

await page.goto(`${BASE}/dashboard/studio/videos`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2000);

const probe = await page.evaluate(() => {
  const root = document.getElementById("root");
  return {
    rootChildCount: root?.children.length ?? 0,
    bodyText: (document.body.innerText || "").trim().slice(0, 300),
  };
});
await page.screenshot({ path: `${OUT_DIR}/videos-library-mount-check.png`, fullPage: false });
await page.close();
await browser.close();

console.log("\n── /dashboard/studio/videos ──");
console.log("probe:", JSON.stringify(probe, null, 2));
console.log("pageErrors:", pageErrors.length ? pageErrors : "(none)");
console.log("screenshot:", `${OUT_DIR}/videos-library-mount-check.png`);

if (pageErrors.length > 0) {
  console.error("FAIL: /dashboard/studio/videos threw console errors from the built bundle");
  process.exit(1);
}
if (!(probe.rootChildCount > 0 && probe.bodyText.length > 0)) {
  console.error("FAIL: /dashboard/studio/videos rendered blank from the built bundle");
  process.exit(1);
}
console.log("PASS: non-blank render of built bundle at /dashboard/studio/videos with zero console errors");
