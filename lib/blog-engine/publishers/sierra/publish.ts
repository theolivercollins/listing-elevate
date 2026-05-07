// lib/blog-engine/publishers/sierra/publish.ts
import type { Page } from 'playwright-core';
import type { BlogPost } from '../../types';
import type { PublishResult } from '../types';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export interface SierraPublishInput {
  baseUrl: string;
  username: string;
  password: string;
  post: BlogPost;
  imageBuffer: Buffer | null;
  imageFilename: string | null;
}

export async function sierraPublish(
  page: Page,
  input: SierraPublishInput,
): Promise<PublishResult> {
  const { baseUrl, username, password, post, imageBuffer, imageFilename } = input;
  await ensureSignedIn(page, baseUrl, username, password);
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  await page.click(SIERRA_SELECTORS.createPostButton);
  await page.waitForSelector(SIERRA_SELECTORS.titleInput);

  await page.fill(SIERRA_SELECTORS.titleInput, post.title);

  if (imageBuffer && imageFilename) {
    const fileInput = await page.$(SIERRA_SELECTORS.imageFileInput);
    if (!fileInput) throw new Error('Sierra image file input not found');
    await fileInput.setInputFiles({
      name: imageFilename,
      mimeType: 'image/jpeg',
      buffer: imageBuffer,
    });
  }

  const sourceToggle = await page.$(SIERRA_SELECTORS.bodyHtmlSourceToggle);
  if (sourceToggle) await sourceToggle.click();
  await page.fill(SIERRA_SELECTORS.bodyHtmlTextarea, post.body_html);

  if (post.author_label) {
    await page.selectOption(SIERRA_SELECTORS.authorSelect, { label: post.author_label });
  }
  if (post.category_label) {
    await page.selectOption(SIERRA_SELECTORS.categorySelect, { label: post.category_label });
  }
  if (post.meta_title) await page.fill(SIERRA_SELECTORS.metaTitleInput, post.meta_title);
  if (post.meta_description)
    await page.fill(SIERRA_SELECTORS.metaDescriptionInput, post.meta_description);
  if (post.meta_tags?.length)
    await page.fill(SIERRA_SELECTORS.metaTagsInput, post.meta_tags.join(', '));

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.publishButton),
  ]);

  await page.waitForSelector(SIERRA_SELECTORS.publishSuccessIndicator, { timeout: 30_000 });

  const finalUrl = page.url();
  const idMatch = finalUrl.match(/[?&](?:id|postId)=(\d+)/i);

  return {
    external_post_url: finalUrl,
    external_post_id: idMatch?.[1] ?? null,
  };
}
