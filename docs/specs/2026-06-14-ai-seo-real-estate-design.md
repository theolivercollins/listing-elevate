# AI SEO for Listing Elevate

Date: 2026-06-14

## Goal

Listing Elevate should generate a crawlable, multi-format SEO package for every public real estate listing video. The package must work for classic search, AI Overviews / AI Mode style answer engines, social previews, and LLM retrieval. It should eventually run autonomously when a public listing link is created or a listing changes.

## Research notes

- Google's AI search guidance still centers on normal SEO fundamentals: crawlable pages, high quality visible text, structured data matching the page, canonical URLs, and strong media assets.
- JavaScript-only public preview pages are weak for crawlers. Listing facts should be available as server-rendered HTML and metadata without relying on SPA hydration.
- Real estate listing pages need schema that matches visible content. The strongest package is a graph containing `RealEstateListing`, `House`, `Offer`, `VideoObject`, and `FAQPage`.
- `llms.txt` is not an official Google requirement, but it is a useful low-risk companion file for LLM agents because it points them to concise markdown resources.
- Public searches did not surface a verifiable GoFlyDragon AI SEO product page. This design treats the request as a product target rather than a literal code or content copy.

## Multi-prong structure

1. Crawlable listing page
   - `/listings/:slug`
   - Server-rendered title, meta description, canonical tag, Open Graph, Twitter card, visible property facts, highlights, FAQ, video links, and JSON-LD.

2. LLM-readable markdown
   - `/listings/:slug.md`
   - Concise listing facts, highlights, media links, representation details, and Q&A with no scripts or HTML.

3. Machine JSON endpoint
   - `/api/seo/listings/:slug.json`
   - Returns the generated artifact and schema graph for automation or future syndication.

4. Discovery files
   - `/sitemap.xml` lists indexable listing pages.
   - `/llms.txt` lists markdown listing resources.
   - `robots.txt` references the sitemap.

5. Studio generation controls
   - Property Command Center shows public SEO status, generation / refresh controls, and links to HTML and markdown assets.
   - A public preview link is required before a listing is indexable.
   - Creating a public preview link automatically attempts to generate the SEO package and refreshes the Studio card.

6. Autonomous path
   - The initial implementation is deterministic-first, admin-triggered, and automatically invoked when a public preview link is created.
   - A future background job can call the same generator when videos complete or property facts change.
   - Paid model enhancement can be added behind the existing Anthropic cost ledger.

7. Production fallback
   - The preferred path stores generated artifacts in `ai_seo_artifacts`.
   - If that table is not present yet, public SEO endpoints derive deterministic artifacts directly from the active public preview token, property facts, photos, and video URLs.
   - The fallback never calls paid AI because it cannot persist the result; Anthropic enhancement only runs when the artifact table is writable.

## Data model

`ai_seo_artifacts` stores one generated package per public preview link.

Key fields:

- `property_id`
- `preview_id`
- `slug`
- `status`
- `indexable`
- `title`
- `meta_description`
- `summary`
- `long_description`
- `highlights`
- `faqs`
- `schema_json`
- `llms_markdown`
- `source_fingerprint`
- `generated_by`
- `model`
- `prompt_version`
- `cost_cents`
- `error`
- timestamps

RLS stays enabled with no anon/authenticated policies. All reads and writes go through service-role API handlers.

The table is additive but not required for first public launch. Without it, `/listings/:slug`, `.md`, JSON, sitemap, and `llms.txt` still work through stateless deterministic generation. Applying the migration later upgrades the system to persistent artifacts and AI-enhanced refreshes without changing public URLs.

## Quality gates

- Do not index revoked, expired, or non-public preview links.
- Never emit script content in markdown.
- Escape HTML attributes and visible fields.
- Keep structured data aligned with visible page content.
- Preserve the cost ledger for every paid provider call.
- Keep deterministic output available when no AI provider key is configured.
- Do not make paid AI calls when generated artifacts cannot be persisted.
