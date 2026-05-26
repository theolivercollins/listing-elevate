# Studio Consolidation — Design

**Date:** 2026-05-26
**Status:** Approved (Oliver, in-session)
**Scope:** Navigation + routing reshuffle. No feature changes.

## Goal

Consolidate three previously-separate surfaces — **Video studio**, **Blog creator**, **Email generator** — into a single top-level **Studio** tab in the dashboard. All three continue to function with no feature regression.

## Decisions

1. **Inner navigation:** sub-tab strip at the top of the Studio surface (Video · Blog · Email). One surface visible at a time. Deep links land directly on a sub-tab.
2. **URL structure:** everything moves under `/dashboard/studio/{video,blog,email}/*`. Every old path gets a `<Navigate replace>` redirect so existing bookmarks, transactional email links, and any external references keep working.
3. **Sidebar:**
   - Rename top section header `"Studio"` → `"Workspace"` (items unchanged: Overview / Pipeline / Listings / Users).
   - Under **Ops**, replace `Video studio` + `Blog creator` with a single `Studio` item pointing at `/dashboard/studio`, matching prefix `/dashboard/studio`. Icon: `play` (already used today).

## Route map

| New path | Component | Old path (redirect from) |
|---|---|---|
| `/dashboard/studio` | layout → redirect to `/video` | — |
| `/dashboard/studio/video` | `StudioHome` | `/dashboard/studio` |
| `/dashboard/studio/video/new` | `StudioNew` | `/dashboard/studio/new` |
| `/dashboard/studio/video/clients` | `StudioClients` | `/dashboard/studio/clients` |
| `/dashboard/studio/video/clients/:id` | `StudioClientEdit` | `/dashboard/studio/clients/:id` |
| `/dashboard/studio/video/properties/:id` | `StudioPropertyCommandCenter` | `/dashboard/studio/properties/:id` |
| `/dashboard/studio/blog/posts` | `BlogPostsList` | `/dashboard/blog/posts` |
| `/dashboard/studio/blog/posts/new` | `BlogPostDetail` | `/dashboard/blog/posts/new` |
| `/dashboard/studio/blog/posts/:id` | `BlogPostDetail` | `/dashboard/blog/posts/:id` |
| `/dashboard/studio/blog/ally-history` | `BlogAllyHistory` | `/dashboard/blog/ally-history` |
| `/dashboard/studio/blog/images` | `BlogImageLibrary` | `/dashboard/blog/images` |
| `/dashboard/studio/blog/templates` | `BlogTemplates` | `/dashboard/blog/templates` |
| `/dashboard/studio/blog/templates/new` | `BlogTemplateDetail` | `/dashboard/blog/templates/new` |
| `/dashboard/studio/blog/templates/:id` | `BlogTemplateDetail` | `/dashboard/blog/templates/:id` |
| `/dashboard/studio/email/messages` | `EmailsList` | `/dashboard/blog/emails` |
| `/dashboard/studio/email/messages/new` | `EmailDetail` | `/dashboard/blog/emails/new` |
| `/dashboard/studio/email/messages/:id` | `EmailDetail` | `/dashboard/blog/emails/:id` |
| `/dashboard/studio/email/templates` | `EmailTemplates` | `/dashboard/blog/email-templates` |
| `/dashboard/studio/email/templates/new` | `EmailTemplateDetail` | `/dashboard/blog/email-templates/new` |
| `/dashboard/studio/email/templates/:id` | `EmailTemplateDetail` | `/dashboard/blog/email-templates/:id` |

Within the email sub-tab the redundant `email` prefix is dropped: `email-templates` → `templates`, `emails` → `messages`.

## New component: `src/components/dashboard/StudioLayout.tsx`

- Layout route at `/dashboard/studio`.
- Renders a page header (`Studio`) + sub-tab strip with three pills.
- Active pill derived from `useLocation()` — first segment after `/studio/` matches `video|blog|email`.
- Pill destinations:
  - Video → `/dashboard/studio/video`
  - Blog → `/dashboard/studio/blog/posts`
  - Email → `/dashboard/studio/email/messages`
- `<Outlet />` below the strip. No other styling intrusion.

## Internal link rewrite

After the redirects are in place every old link works. We also rewrite hard-coded paths in source so we don't rely on redirect hops:

- `rg "/dashboard/blog/"` → swap to `/dashboard/studio/blog/...` / `/dashboard/studio/email/...`
- `rg "/dashboard/studio/(new|clients|properties)"` → swap to `/dashboard/studio/video/...`

External references we will NOT chase (these depend on the redirect): blog post share links, marketing campaigns, transactional emails. They keep working via `<Navigate replace>`.

## Out of scope

- Any change to the three feature surfaces themselves.
- Any data model / API / cost-event change.
- Removal of redirects (kept indefinitely for external link safety).

## Verification

- `pnpm build` clean.
- Dev server: each sub-tab loads, deep-links work, every redirect lands on the right new path.
- The pre-existing `crypto/createHmac` warning from `lib/providers/kling.ts` is unrelated and stays.

## Branch

Work lands on the current branch `feat/prompt-lab-version-toggle` per Oliver's call ("do whatever u see best fit"). Per LE branch model, promote via PR → dev → staging → main.
