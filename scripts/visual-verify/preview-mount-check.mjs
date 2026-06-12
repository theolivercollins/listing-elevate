// T7 final-gate mount check (2026-05-28 blank-screen lesson):
// load /preview/<fake-token> from the BUILT bundle in headless Chromium and
// assert the page renders non-blank. The styled 404/expired state counts as a
// render; a blank #root (bundle crash) fails.
//
// T14 extension: also load /preview/<fake-token>/embed and assert the LEPlayer
// surface (data-testid='le-player') mounts with zero console errors.
//
// Usage: npx vite preview --port 4173 &  then  node scripts/visual-verify/preview-mount-check.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:4173";
// Well-formed per isWellFormedToken (/^[A-Za-z0-9_-]{32}$/) but nonexistent.
const FAKE_TOKEN = "T7faketoken_T7faketoken_T7faketo";
const OUT_DIR = "/tmp/le-visual";

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// ─── Check 1: /preview/<fake-token> (watch page — 404 path) ─────────────────

{
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
  await page.screenshot({ path: `${OUT_DIR}/preview-mount-check.png`, fullPage: false });
  await page.close();

  console.log("\n── /preview/<fake-token> ──");
  console.log("probe:", JSON.stringify(probe, null, 2));
  console.log("pageErrors:", pageErrors.length ? pageErrors : "(none)");
  console.log("screenshot:", `${OUT_DIR}/preview-mount-check.png`);

  const nonBlank = probe.rootChildCount > 0 && probe.bodyText.length > 0;
  if (pageErrors.length > 0) {
    await browser.close();
    console.error("FAIL: /preview/<fake-token> threw a console error");
    process.exit(1);
  }
  if (!nonBlank) {
    await browser.close();
    console.error("FAIL: /preview/<fake-token> rendered blank from the built bundle");
    process.exit(1);
  }
  console.log("PASS: non-blank render of built bundle at /preview/<fake-token>");
}

// ─── Check 2: /preview/<fake-token>/embed (embed page — LEPlayer mounts) ────
//
// The embed fetches GET /api/preview/<token>. We stub it to return a minimal
// valid payload (horizontal video URL) so EmbedPage proceeds past the 404
// branch and renders LEPlayer. This proves the embed chunk imported cleanly
// from the built bundle; a top-level crash or missing import would throw a
// pageerror regardless of API stubbing.

{
  const EMBED_STUB = JSON.stringify({
    address: "123 Embed Ln, Test City",
    video_url: "https://cdn.example.com/fake-h.mp4",
    videos: { horizontal: "https://cdn.example.com/fake-h.mp4", vertical: null },
    thumbnail_url: null,
    brand: null,
    kind: "client",
    capabilities: { download: false, approve: false, revision: false },
    approved_at: null,
  });

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

  // Stub the preview API to return a valid payload so LEPlayer renders.
  await page.route("**/api/preview/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: EMBED_STUB }),
  );

  await page.goto(`${BASE}/preview/${FAKE_TOKEN}/embed`, { waitUntil: "networkidle" }).catch(() => {});
  // Wait for the API fetch → state update → LEPlayer mount cycle to complete.
  await page.waitForTimeout(2000);

  const probe = await page.evaluate(() => {
    const root = document.getElementById("root");
    const lePlayer = document.querySelector('[data-testid="le-player"]');
    const embedNotAvailable = document.querySelector('[data-testid="embed-not-available"]');
    return {
      rootChildCount: root?.children.length ?? 0,
      bodyText: (document.body.innerText || "").trim().slice(0, 400),
      lePlayerPresent: Boolean(lePlayer),
      embedNotAvailablePresent: Boolean(embedNotAvailable),
    };
  });
  await page.screenshot({ path: `${OUT_DIR}/preview-embed-mount-check.png`, fullPage: false });
  await page.close();

  console.log("\n── /preview/<fake-token>/embed ──");
  console.log("probe:", JSON.stringify(probe, null, 2));
  console.log("pageErrors:", pageErrors.length ? pageErrors : "(none)");
  console.log("screenshot:", `${OUT_DIR}/preview-embed-mount-check.png`);

  if (pageErrors.length > 0) {
    await browser.close();
    console.error("FAIL: /preview/<fake-token>/embed threw console errors:", pageErrors);
    process.exit(1);
  }
  if (!probe.lePlayerPresent) {
    await browser.close();
    console.error(
      "FAIL: /preview/<fake-token>/embed did not render [data-testid='le-player'] " +
        `(embed-not-available=${probe.embedNotAvailablePresent}, rootChildCount=${probe.rootChildCount})`,
    );
    process.exit(1);
  }
  console.log(
    "PASS: [data-testid='le-player'] mounted from the built bundle at /preview/<fake-token>/embed with zero console errors",
  );
}

await browser.close();
console.log("\nAll mount checks passed.");
