// lib/blog-engine/publishers/sierra/edit.ts
import type { Page } from 'playwright-core';
import type { BlogPost } from '../../types';
import type { EditResult } from '../types';
import { SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export type EditableField =
  | 'title' | 'body_html'
  | 'meta_title' | 'meta_description' | 'meta_tags'
  | 'author' | 'category';

export interface SierraEditInput {
  baseUrl: string;
  username: string;
  password: string;
  post: BlogPost;
  fieldsChanged: Set<EditableField>;
}

export async function sierraEdit(
  page: Page,
  input: SierraEditInput,
): Promise<EditResult> {
  const { baseUrl, username, password, post, fieldsChanged } = input;
  if (!post.external_post_url) throw new Error('Edit requires post.external_post_url');

  await ensureSignedIn(page, baseUrl, username, password);
  await page.goto(post.external_post_url, { waitUntil: 'domcontentloaded' });

  const editButton = await page.$(SIERRA_SELECTORS.editButton);
  if (editButton) {
    await editButton.click();
    await page.waitForSelector(SIERRA_SELECTORS.titleInput);
  }

  if (fieldsChanged.has('title')) {
    await page.fill(SIERRA_SELECTORS.titleInput, post.title);
  }
  if (fieldsChanged.has('body_html')) {
    const sourceToggle = await page.$(SIERRA_SELECTORS.bodyHtmlSourceToggle);
    if (sourceToggle) await sourceToggle.click();
    await page.fill(SIERRA_SELECTORS.bodyHtmlTextarea, post.body_html);
  }
  if (fieldsChanged.has('meta_title') && post.meta_title != null) {
    await page.fill(SIERRA_SELECTORS.metaTitleInput, post.meta_title);
  }
  if (fieldsChanged.has('meta_description') && post.meta_description != null) {
    await page.fill(SIERRA_SELECTORS.metaDescriptionInput, post.meta_description);
  }
  if (fieldsChanged.has('meta_tags')) {
    await page.fill(SIERRA_SELECTORS.metaTagsInput, post.meta_tags.join(', '));
  }
  if (fieldsChanged.has('author') && post.author_label) {
    await page.selectOption(SIERRA_SELECTORS.authorSelect, { label: post.author_label });
  }
  if (fieldsChanged.has('category') && post.category_label) {
    await page.selectOption(SIERRA_SELECTORS.categorySelect, { label: post.category_label });
  }

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.updateButton),
  ]);
  await page.waitForSelector(SIERRA_SELECTORS.publishSuccessIndicator, { timeout: 30_000 });

  return { external_post_url: page.url() };
}
