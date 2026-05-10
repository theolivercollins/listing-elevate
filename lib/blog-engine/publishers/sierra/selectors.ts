// lib/blog-engine/publishers/sierra/selectors.ts
//
// Selectors are best-guess starting points. The first publish run will reveal
// any that need tuning; update here, never inline in the click-path files.

export const SIERRA_PATHS = {
  blogManager: '/blog-manager.aspx',
  login: '/login.aspx',
} as const;

export const SIERRA_SELECTORS = {
  // Sierra login page has multiple forms (login + forgot-username + forgot-password),
  // each with similar inputs. Filter to :visible so we never grab the hidden ones,
  // and prefer the canonical Sierra login field names when present.
  // Sierra also requires a SITE NAME (the customer's public domain) as a third
  // field on the login form — fill it before username/password.
  loginSiteNameInput: 'input[name*="ite" i]:visible:not([type="password"]):not([id*="forgot" i]), input[name*="omain" i]:visible:not([id*="forgot" i]), input[id*="ite" i]:visible:not([type="password"]):not([id*="forgot" i])',
  loginUsernameInput: 'input[name="Username"]:visible, input[type="email"]:visible:not([id*="forgot" i]), input[name*="UserName" i]:visible:not([id*="forgot" i])',
  loginPasswordInput: 'input[name="Password"]:visible, input[type="password"]:visible',
  // Sierra login page has multiple submit buttons (Login, Forgot Username, Forgot Password).
  // Target the actual login button by its visible label.
  loginSubmitButton: 'input[type="submit"][value*="Log" i]:visible, input[type="submit"][value*="Sign" i]:visible, button:has-text("Log In"):visible, button:has-text("Login"):visible, button:has-text("Sign In"):visible',

  createPostButton: 'a:has-text("Create Blog Post"), button:has-text("Create Blog Post")',
  editButton: 'a:has-text("Edit"):visible',

  titleInput: 'input[name*="Title" i]:visible:not([name*="Meta" i]):not([type="hidden"]), input[id*="Title" i]:visible:not([id*="Meta" i]):not([type="hidden"])',
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
