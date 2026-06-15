# AI SEO Real Estate Implementation Plan

Date: 2026-06-14

## Plan

1. Add deterministic SEO artifact builder.
   - Slug, property facts, highlights, FAQs, markdown, schema graph, and fingerprint.
   - Focused unit tests first.

2. Add persistence.
   - `ai_seo_artifacts` migration.
   - Repository helpers to fetch property, newest public preview, client, photo, and scene facts.
   - Add a stateless fallback that derives artifacts from active public previews when the migration has not been applied yet.

3. Add generation API.
   - `GET /api/admin/studio/properties/:id/seo`
   - `POST /api/admin/studio/properties/:id/seo`
   - Public preview must exist and be active.

4. Add public SEO endpoints.
   - `/listings/:slug`
   - `/listings/:slug.md`
   - `/api/seo/listings/:slug.json`
   - `/sitemap.xml`
   - `/llms.txt`
   - Update `robots.txt`.

5. Add Studio UI.
   - Property Command Center SEO package card.
   - Generate / refresh.
   - Open and copy HTML / markdown links.

6. Verify.
   - Targeted tests.
   - Full test suite.
   - Build.
   - Browser check for the Studio panel when the local app can run.

## Production readiness note

The feature can launch before `089_ai_seo_artifacts.sql` is applied. Public endpoints fall back to deterministic, zero-cost artifacts from `property_previews`, `properties`, `clients`, and `photos`. Applying the migration later enables durable artifacts, idempotent refreshes, and paid Anthropic enhancement.
