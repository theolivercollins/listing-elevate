// Visual-verify harness: screenshots PUBLIC surfaces of the local preview build.
// (Authed dashboard/studio surfaces are deliberately out of scope — no auth bypass.)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:4173";
const OUT = "/tmp/le-visual";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("PAGEERROR:", String(e).slice(0, 300)));
page.on("console", m => {
  if (m.type() === "error") console.log("CONSOLEERR:", m.text().slice(0, 200));
});

async function shot(name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
  console.log("shot:", name);
}

// 1. Marketing landing (pinned dark)
await page.goto(BASE + "/", { waitUntil: "networkidle" }).catch(() => {});
await shot("01-landing-hero");

// CTA base vs hover
const heroCta = page.locator("a", { hasText: /create your first video|get started/i }).first();
await heroCta.hover().catch(e => console.log("hover miss:", String(e).slice(0, 80)));
await shot("02-landing-hero-cta-hover", { wait: 500 });

// nav link hover
const navLink = page.locator("nav a", { hasText: /process|showcase|pricing/i }).first();
await navLink.hover().catch(() => {});
await shot("03-landing-nav-hover", { wait: 500 });

// pricing section (scroll to it)
await page.evaluate(() => {
  const els = [...document.querySelectorAll("span,div")];
  const el = els.find(e => /pricing/i.test(e.textContent || "") && e.className?.includes?.("le-eyebrow"));
  el?.scrollIntoView({ block: "start" });
});
await shot("04-landing-pricing", { wait: 1500 });

// pricing CTA hover
const priceCta = page.locator("a", { hasText: /start|choose|order/i }).first();
await priceCta.hover().catch(() => {});
await shot("05-landing-pricing-cta-hover", { wait: 400 });

// FinalCTA at bottom
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot("06-landing-final-cta", { wait: 1500 });

// 2. Login dialog
await page.goto(BASE + "/?login=1", { waitUntil: "networkidle" }).catch(() => {});
await shot("07-login-dialog", { wait: 2000 });

// 3. Public upload outcome pages + 404
await page.goto(BASE + "/upload/cancelled", { waitUntil: "networkidle" }).catch(() => {});
await shot("08-upload-cancelled");
await page.goto(BASE + "/upload/success", { waitUntil: "networkidle" }).catch(() => {});
await shot("09-upload-success");
await page.goto(BASE + "/nope-404", { waitUntil: "networkidle" }).catch(() => {});
await shot("10-not-found");

await browser.close();
console.log("done");
