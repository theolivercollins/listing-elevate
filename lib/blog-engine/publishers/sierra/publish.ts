// lib/blog-engine/publishers/sierra/publish.ts
import type { Page } from "playwright-core";
import type { BlogPost } from "../../types.js";
import type { PublishResult } from "../types.js";
import { SIERRA_PATHS, SIERRA_SELECTORS } from "./selectors.js";
import { ensureSignedIn, type SierraCreds } from "./auth.js";
import { inputByLabelText, selectByLabelText } from "./dom-helpers.js";

export interface SierraPublishInput {
  baseUrl: string;
  creds: SierraCreds;
  post: BlogPost;
  imageBuffer: Buffer | null;
  imageFilename: string | null;
}

/** Sierra blog-post slug rule: lowercase, alphanumerics + hyphen only. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function sierraPublish(
  page: Page,
  input: SierraPublishInput,
): Promise<PublishResult> {
  const { baseUrl, creds, post, imageBuffer, imageFilename } = input;
  await ensureSignedIn(page, baseUrl, creds);
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
  await page.click(SIERRA_SELECTORS.createPostButton);

  const titleField = inputByLabelText(page, "Post Title");
  await titleField.waitFor({ timeout: 30_000 });
  await titleField.fill(post.title);

  const fileNameField = inputByLabelText(page, "Post Filename");
  if (await fileNameField.count()) {
    await fileNameField.fill(post.slug ?? slugify(post.title));
  }

  if (imageBuffer && imageFilename) {
    const fileInput = await page.$(SIERRA_SELECTORS.imageFileInput);
    if (!fileInput) throw new Error("Sierra image file input not found");
    await fileInput.setInputFiles({
      name: imageFilename,
      mimeType: "image/jpeg",
      buffer: imageBuffer,
    });
  }

  // Sierra uses TinyMCE 8 for the body. Easiest path: call its setContent API
  // directly. This bypasses the iframe-and-toolbar dance entirely.
  //
  // TinyMCE 8 dropped the public `tinymce.editors` collection in favor of
  // `tinymce.activeEditor` and `tinymce.get(idx)`. Probing on the live form
  // (2026-05-13) shows `tinymce.editors` is undefined even after the editor
  // iframe is fully rendered, so the old `editors?.length > 0` guard never
  // resolves and the publish times out. Poll the accessors instead.
  await page.waitForFunction(
    () => {
      const tm = (window as any).tinymce;
      if (!tm) return false;
      const ed = (typeof tm.get === "function" ? tm.get(0) : null) ?? tm.activeEditor;
      return !!ed && ed.initialized === true;
    },
    { timeout: 30_000 },
  );
  await page.evaluate((html: string) => {
    const tm = (window as any).tinymce;
    // First editor on the page is the post body.
    const ed = tm.get(0) ?? tm.activeEditor;
    if (!ed) throw new Error("TinyMCE editor not found");
    ed.setContent(html);
    ed.save(); // sync TinyMCE state into the underlying <textarea> so form submit picks it up
  }, post.body_html);

  if (post.author_label) {
    const authorSelect = selectByLabelText(page, "Author");
    if (await authorSelect.count()) {
      await authorSelect.selectOption({ label: post.author_label });
    }
  }
  if (post.category_label) {
    const categorySelect = selectByLabelText(page, "Category");
    if (await categorySelect.count()) {
      await categorySelect.selectOption({ label: post.category_label });
    }
  }
  if (post.meta_title) {
    const f = inputByLabelText(page, "Meta Title");
    if (await f.count()) await f.fill(post.meta_title);
  }
  if (post.meta_description) {
    const f = inputByLabelText(page, "Meta Description");
    if (await f.count()) await f.fill(post.meta_description);
  }
  if (post.meta_tags?.length) {
    // Sierra labels this field "Meta Keywords" (not "Meta Tags").
    const f = inputByLabelText(page, "Meta Keywords");
    if (await f.count()) await f.fill(post.meta_tags.join(", "));
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.click(SIERRA_SELECTORS.publishButton),
  ]);

  await page.waitForSelector(SIERRA_SELECTORS.publishSuccessIndicator, { timeout: 30_000 });

  // Sierra keeps the form-with-filters URL after publish (no redirect to the
  // newly-created post). The new id only surfaces in the blog manager list.
  // Bounce there and look up the row by title to capture a stable
  // external_post_url + external_post_id. Title uniqueness within the most
  // recent post window is good enough — Sierra orders newest-first, and we
  // grab the first hit.
  const lookup = await findPostInBlogManager(page, baseUrl, post.title);

  return {
    external_post_url: lookup?.editUrl ?? page.url(),
    external_post_id: lookup?.postId ?? null,
  };
}

async function findPostInBlogManager(
  page: Page,
  baseUrl: string,
  title: string,
): Promise<{ editUrl: string; postId: string } | null> {
  try {
    await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: "domcontentloaded" });
    const href = await page
      .locator(`a:has-text(${JSON.stringify(title)})`)
      .first()
      .evaluate((el) => (el as HTMLAnchorElement).href)
      .catch(() => null);
    if (!href) return null;
    const m = href.match(/[?&](?:id|postId)=(\d+)/i);
    return { editUrl: href, postId: m?.[1] ?? "" };
  } catch {
    return null;
  }
}
