// lib/blog-engine/publishers/sierra/selectors.ts
//
// Selectors are best-guess starting points. The first publish run will reveal
// any that need tuning; update here, never inline in the click-path files.

export const SIERRA_PATHS = {
  blogManager: '/blog-manager.aspx',
  login: '/login.aspx',
} as const;

export const SIERRA_SELECTORS = {
  loginUsernameInput: 'input[name="Username"], input[type="email"]',
  loginPasswordInput: 'input[name="Password"], input[type="password"]',
  loginSubmitButton: 'button[type="submit"], input[type="submit"]',

  createPostButton: 'a:has-text("Create Blog Post"), button:has-text("Create Blog Post")',
  editButton: 'a:has-text("Edit"):visible',

  titleInput: 'input[name*="Title"]:not([name*="Meta"])',
  imageFileInput: 'input[type="file"]',
  bodyHtmlSourceToggle: 'a:has-text("Source"), button:has-text("HTML")',
  bodyHtmlTextarea: 'textarea[name*="Body"], textarea.html-source',
  authorSelect: 'select[name*="Author"]',
  categorySelect: 'select[name*="Category"]',
  metaTitleInput: 'input[name*="MetaTitle"]',
  metaDescriptionInput: 'textarea[name*="MetaDescription"], input[name*="MetaDescription"]',
  metaTagsInput: 'input[name*="MetaTags"], input[name*="Keywords"]',

  publishButton: 'button:has-text("Publish"), input[value="Publish"]',
  updateButton: 'button:has-text("Update"), input[value="Update"]',
  publishSuccessIndicator: 'text=/successfully|saved|published/i',
} as const;

export type SierraSelectorKey = keyof typeof SIERRA_SELECTORS;
