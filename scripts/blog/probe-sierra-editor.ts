// scripts/blog/probe-sierra-editor.ts
//
// One-shot probe: log into Sierra blog manager, open the "Create Blog Post"
// form, and dump enough info to tell what rich-text editor Sierra is using
// now (was TinyMCE; the live publisher times out waiting for tinymce.editors).
//
// Run from the worktree:
//   set -a && source .env && source .env.local && set +a && \
//     SIERRA_HELGEMO_USERNAME=... SIERRA_HELGEMO_PASSWORD=... \
//     SIERRA_HELGEMO_SITE_NAME=... SIERRA_HELGEMO_BASE_URL=... \
//     npx tsx scripts/blog/probe-sierra-editor.ts

import "dotenv/config";
import { getOrCreatePersistentContextId, runInSession } from "../../lib/blog-engine/browserbase.js";
import { ensureSignedIn } from "../../lib/blog-engine/publishers/sierra/auth.js";
import { SIERRA_PATHS, SIERRA_SELECTORS } from "../../lib/blog-engine/publishers/sierra/selectors.js";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: site, error } = await supabase
    .from("blog_sites").select("*").eq("host_kind", "sierra").single();
  if (error || !site) throw new Error("no Sierra site row");
  const baseUrl = site.base_url as string;

  const username = process.env.SIERRA_HELGEMO_USERNAME!;
  const password = process.env.SIERRA_HELGEMO_PASSWORD!;
  const siteName = process.env.SIERRA_HELGEMO_SITE_NAME!;
  if (!username || !password || !siteName) throw new Error("Sierra creds missing");

  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id ?? null);
  console.log("probe: using browserbase context", contextId);

  const { result } = await runInSession(contextId, async ({ page }) => {
    await ensureSignedIn(page, baseUrl, { siteName, username, password });
    console.log("probe: signed in. URL =", page.url());

    await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
    console.log("probe: blog manager =", page.url());

    const createBtnCount = await page.locator(SIERRA_SELECTORS.createPostButton).count();
    console.log("probe: createPostButton count =", createBtnCount);
    if (createBtnCount === 0) {
      const links = await page.locator("a:visible").allTextContents();
      console.log("probe: visible link texts =", links.slice(0, 40));
      return null;
    }

    await page.click(SIERRA_SELECTORS.createPostButton);
    await page.waitForLoadState("domcontentloaded");
    console.log("probe: after Create click, URL =", page.url());

    // Give Sierra a moment to load assets (some lazy editors only kick in after first focus).
    await page.waitForTimeout(8_000);

    const info = await page.evaluate(() => {
      const w = window as any;
      const out: Record<string, any> = {
        url: location.href,
        title: document.title,
        hasTinymce: typeof w.tinymce !== "undefined",
        tinymceEditorsLen: typeof w.tinymce !== "undefined" && w.tinymce.editors ? w.tinymce.editors.length : null,
        hasCKEditor: typeof w.CKEDITOR !== "undefined",
        ckEditorInstancesLen: typeof w.CKEDITOR !== "undefined" && w.CKEDITOR.instances ? Object.keys(w.CKEDITOR.instances).length : null,
        hasCKEditor5: typeof w.ClassicEditor !== "undefined" || typeof w.ckeditor !== "undefined",
        hasFroala: typeof w.FroalaEditor !== "undefined",
        hasQuill: typeof w.Quill !== "undefined",
        hasMonaco: typeof w.monaco !== "undefined",
        iframes: Array.from(document.querySelectorAll("iframe")).map((f) => ({ id: f.id, src: f.src, className: f.className })).slice(0, 10),
        textareas: Array.from(document.querySelectorAll("textarea")).map((t) => ({ id: (t as HTMLTextAreaElement).id, name: (t as HTMLTextAreaElement).name, classes: (t as HTMLTextAreaElement).className })).slice(0, 10),
        scriptsWithEditorKey: Array.from(document.querySelectorAll("script[src]"))
          .map((s) => (s as HTMLScriptElement).src)
          .filter((s) => /tinymce|ckeditor|froala|quill|tiny|editor|wysiwyg/i.test(s))
          .slice(0, 10),
      };
      return out;
    });
    console.log("probe: editor environment info =", JSON.stringify(info, null, 2));
    return info;
  });

  console.log("probe done. result =", result ? "(see above)" : "(no create button)");
}

main().catch((e) => { console.error(e); process.exit(1); });
