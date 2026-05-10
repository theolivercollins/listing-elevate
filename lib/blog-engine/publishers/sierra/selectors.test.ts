// lib/blog-engine/publishers/sierra/selectors.test.ts
import { describe, it, expect } from 'vitest';
import { SIERRA_SELECTORS, SIERRA_PATHS } from './selectors';

describe('Sierra selectors', () => {
  it('declares every selector the publish flow needs', () => {
    expect(Object.keys(SIERRA_SELECTORS).sort()).toEqual([
      'authorSelect',
      'bodyHtmlSourceToggle',
      'bodyHtmlTextarea',
      'categorySelect',
      'createPostButton',
      'editButton',
      'imageFileInput',
      'loginPasswordInput',
      'loginSiteNameInput',
      'loginSubmitButton',
      'loginUsernameInput',
      'metaDescriptionInput',
      'metaTagsInput',
      'metaTitleInput',
      'publishButton',
      'publishSuccessIndicator',
      'titleInput',
      'updateButton',
    ].sort());
  });

  it('has the canonical Sierra paths', () => {
    expect(SIERRA_PATHS.blogManager).toBe('/blog-manager.aspx');
    expect(SIERRA_PATHS.login).toBe('/login.aspx');
  });
});
