// scripts/blog/verify-post-live.ts
// Open Sierra blog manager and check whether a given post title appears in the list.

import "dotenv/config";
import { getOrCreatePersistentContextId, runInSession } from "../../lib/blog-engine/browserbase.js";
import { ensureSignedIn } from "../../lib/blog-engine/publishers/sierra/auth.js";
import { SIERRA_PATHS } from "../../lib/blog-engine/publishers/sierra/selectors.js";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const titleNeedle = process.argv[2];
  if (!titleNeedle) throw new Error("usage: verify-post-live.ts <title-substring>");

  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("*").eq("host_kind", "sierra").single();
  if (!site) throw new Error("no Sierra site row");
  const baseUrl = site.base_url as string;

  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id ?? null);

  await runInSession(contextId, async ({ page }) => {
    await ensureSignedIn(page, baseUrl, {
      siteName: process.env.SIERRA_HELGEMO_SITE_NAME!,
      username: process.env.SIERRA_HELGEMO_USERNAME!,
      password: process.env.SIERRA_HELGEMO_PASSWORD!,
    });
    await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);

    const html = await page.content();
    const titleMatches = html.toLowerCase().includes(titleNeedle.toLowerCase());
    console.log(`title "${titleNeedle}" present in blog-manager page: ${titleMatches}`);

    // Try to extract the first row that matches the title and report the row text.
    const rows = await page.locator(`tr:has-text(${JSON.stringify(titleNeedle)})`).allTextContents();
    console.log(`matching rows (max 5):`, rows.slice(0, 5));

    // Also try to find a link to the post detail (Sierra blog post edit page has postId in href).
    const postLinks = await page
      .locator(`a:has-text(${JSON.stringify(titleNeedle)})`)
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href).slice(0, 3));
    console.log(`post edit links:`, postLinks);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
