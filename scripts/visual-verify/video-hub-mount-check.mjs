// T9 mount check: load the Studio video hub route from the BUILT bundle in
// headless Chromium and assert the bundle renders without an uncaught error.
// The hub is admin-gated, so an unauthenticated hit lands on the login/landing
// surface — that still proves the new VideoHub chunk imports cleanly (a syntax
// or top-level crash in VideoHub would throw a pageerror regardless of auth).
//
// Usage: npx vite preview --port 4173 &  then  node scripts/visual-verify/video-hub-mount-check.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = "/tmp/le-visual/video-hub-mount-check.png";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

// Stub the hub API so the route would render the hub if it were reachable.
await page.route("**/api/admin/studio/videos/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      property: { id: "prop-1", address: "1 Test St, Town", videos: { horizontal: "x.mp4", vertical: "y.mp4" } },
      client: { id: "c1", name: "Client" },
      hero_photo_url: null,
      links: [],
      revision_notes: [],
      totals: { total_plays: 0, unique_viewers: 0, avg_completion_pct: 0 },
    }),
  }),
);

await page.goto(`${BASE}/dashboard/studio/videos/prop-1`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const root = document.getElementById("root");
  return {
    rootChildCount: root?.children.length ?? 0,
    bodyText: (document.body.innerText || "").trim().slice(0, 300),
  };
});
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();

console.log("probe:", JSON.stringify(probe, null, 2));
console.log("pageErrors:", pageErrors.length ? pageErrors : "(none)");
console.log("screenshot:", OUT);

if (pageErrors.length > 0) {
  console.error("FAIL: built bundle threw while loading the video hub route");
  process.exit(1);
}
if (probe.rootChildCount === 0 || probe.bodyText.length === 0) {
  console.error("FAIL: blank render from the built bundle at the video hub route");
  process.exit(1);
}
console.log("PASS: built bundle renders non-blank with no uncaught error at the video hub route");
