// lib/blog-engine/publishers/sierra/edit.ts
import type { Page } from "playwright-core";
import type { BlogPost } from "../../types";
import type { EditResult } from "../types";
import { SIERRA_SELECTORS } from "./selectors";
import { ensureSignedIn, type SierraCreds } from "./auth";
import { inputByLabelText, selectByLabelText } from "./dom-helpers";

export type EditableField =
  | "title" | "body_html"
  | "meta_title" | "meta_description" | "meta_tags"
  | "author" | "category";

export interface SierraEditInput {
  baseUrl: string;
  creds: SierraCreds;
  post: BlogPost;
  fieldsChanged: Set<EditableField>;
}

export async function sierraEdit(
  page: Page,
  input: SierraEditInput,
): Promise<EditResult> {
  const { baseUrl, creds, post, fieldsChanged } = input;
  if (!post.external_post_url) throw new Error("Edit requires post.external_post_url");

  await ensureSignedIn(page, baseUrl, creds);
  await page.goto(post.external_post_url, { waitUntil: "domcontentloaded" });

  // Sierra's edit page renders the same Add Blog Post form pre-populated.
  // Wait for the title input to confirm the form is ready.
  await inputByLabelText(page, "Post Title").waitFor({ timeout: 30_000 });

  if (fieldsChanged.has("title")) {
    await inputByLabelText(page, "Post Title").fill(post.title);
  }
  if (fieldsChanged.has("body_html")) {
    // TinyMCE: set content via API rather than poking the underlying textarea.
    await page.waitForFunction(
      () => typeof (window as any).tinymce !== "undefined" && (window as any).tinymce.editors?.length > 0,
      { timeout: 30_000 },
    );
    await page.evaluate((html: string) => {
      const tm = (window as any).tinymce;
      const ed = tm.get(0) ?? tm.activeEditor;
      if (!ed) throw new Error("TinyMCE editor not found");
      ed.setContent(html);
      ed.save();
    }, post.body_html);
  }
  if (fieldsChanged.has("meta_title") && post.meta_title != null) {
    await inputByLabelText(page, "Meta Title").fill(post.meta_title);
  }
  if (fieldsChanged.has("meta_description") && post.meta_description != null) {
    await inputByLabelText(page, "Meta Description").fill(post.meta_description);
  }
  if (fieldsChanged.has("meta_tags")) {
    await inputByLabelText(page, "Meta Keywords").fill(post.meta_tags.join(", "));
  }
  if (fieldsChanged.has("author") && post.author_label) {
    await selectByLabelText(page, "Author").selectOption({ label: post.author_label });
  }
  if (fieldsChanged.has("category") && post.category_label) {
    await selectByLabelText(page, "Category").selectOption({ label: post.category_label });
  }

  // Sierra's edit form uses the "Save" or "Publish" button rather than Update.
  // Click whichever exists, prefer Save (in-place update) over Publish (re-publish).
  const saveButton = await page.$('button:has-text("Save"):visible, input[value="Save"]:visible');
  if (saveButton) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      saveButton.click(),
    ]);
  } else {
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click(SIERRA_SELECTORS.publishButton),
    ]);
  }

  // Some Sierra screens redirect to a list view on save instead of showing a
  // toast; treat that as success too.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  return { external_post_url: page.url() };
}
