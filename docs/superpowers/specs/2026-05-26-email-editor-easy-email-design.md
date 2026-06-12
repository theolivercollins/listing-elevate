# Email Editor: Unlayer → Easy Email — Design

**Date:** 2026-05-26
**Status:** Approved (Oliver, in-session)
**Branch:** `feat/email-editor-easy-email`

## Goal

Replace the iframed Unlayer drag-and-drop email builder with [`easy-email-editor`](https://www.npmjs.com/package/easy-email-editor) (MIT, React-native, MJML output, v4.16.6 published 2026-04-28). Native styling, real block library, MJML output for best cross-client deliverability.

## Why

Unlayer renders its UI inside an iframe with its own design tokens, so the email composer looks like a different app the moment a user opens it. Easy Email is React-native — our shadcn theme reaches the editor's chrome. It also outputs MJML, which compiles to bulletproof email HTML for every major client.

## Decisions

1. **Hard cutover with detect-on-load bridge.** Existing Unlayer-shaped `design_json` rows are detected at load time; the stored `body_html` gets wrapped in a single Easy Email `custom-html` block so the email remains editable (the imported HTML block is non-decomposable, but it renders + can be augmented with new Easy Email blocks). No migration script; no data backfill.
2. **Brand kit locked to LE tokens for v1.** Colors: `#0A2540` headers, `#E97316` CTAs. Fonts: Inter sans stack (no JetBrains Mono ever — per LE rule). Per-tenant brand kits deferred until a client asks.
3. **MJML rendered server-side at save time** via the `mjml` npm package; persisted as `body_html`. `design_json` stores Easy Email's `IBlockData` tree.

## Out of scope

- AMP for email
- Real-time collaboration
- Per-tenant brand kit override
- Stock template library (we have ~5 templates; Stripo has hundreds — we'll add LE-specific ones as patterns emerge)

## Architecture

### Component: `src/components/blog/EmailDesigner.tsx`

Public handle contract **unchanged** so consumers don't touch:

```ts
export interface EmailDesignerHandle {
  exportHtml: (cb: (design: any, html: string) => void) => void;
}
interface Props {
  initialDesign?: any;
  initialHtml?: string;
  onSave: (design: any, html: string) => void;
  onChange?: () => void;
  onTestSend?: () => void;
}
```

Internals replaced:

- `<EmailEditorProvider>` from `easy-email-editor` wraps the canvas
- LE brand theme registered as the provider's `data` default
- LE custom blocks registered before mount (CTA, listing card, agent footer)
- `exportHtml` resolves by reading current design JSON from the editor's `getValue()` API, then calling `mjml(toMjml(design))` to render HTML

### Brand kit

```ts
const LE_BRAND = {
  colors: {
    primary: "#0A2540",
    accent:  "#E97316",
    text:    "#0F172A",
    muted:   "#64748B",
    surface: "#FFFFFF",
    line:    "#E5E7EB",
  },
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  containerWidth: 600,
};
```

Applied via Easy Email's `data.attributes` defaults + a custom theme passed to the provider.

### LE custom blocks

| Block | What it is | MJML shape |
|---|---|---|
| `le-cta` | Bulletproof CTA button — label + href + (optional) sub-line | `<mj-button>` with table-cell fallback |
| `le-listing-card` | Hero image + address + price + CTA, all clickable | `<mj-section>` with `<mj-column>` x2 (image, content) |
| `le-agent-footer` | Avatar + name + license + brokerage + `{{UNSUBSCRIBE_URL}}` | `<mj-section>` with `<mj-divider>` above |

Registered via `BlockManager.registerBlocks([leCtaBlock, leListingCardBlock, leAgentFooterBlock])` in a single `src/components/blog/le-email-blocks.ts` module.

### Legacy bridge

`src/components/blog/email-design-bridge.ts`:

```ts
export function isUnlayerShape(design: any): boolean {
  return !!design && typeof design === "object"
    && "body" in design && "rows" in (design.body ?? {})
    && !("type" in design);
}

export function bridgeUnlayerDesign(initialHtml: string): IBlockData {
  // Returns an Easy Email page with a single custom-html block containing initialHtml
}
```

In `EmailDesigner`, on first load:
```ts
const initial =
  initialDesign && isUnlayerShape(initialDesign)
    ? bridgeUnlayerDesign(initialHtml ?? "")
    : initialDesign ?? blankPage();
```

### Save pipeline

`exportHtml` flow:
1. Read current design from editor (`IBlockData`)
2. Call `JsonToMjml({ data: design, mode: 'production', context: design })` from `easy-email-core`
3. Call `mjml(mjmlString, { validationLevel: 'soft', minify: true })` from the `mjml` npm package
4. Pass `(design, html)` to the callback

`mjml` is server-renderable but Easy Email ships a browser-friendly variant — confirm in implementation. If browser bundle is too heavy, move the render to a small POST endpoint `/api/blog/email/render` that takes design JSON and returns HTML.

## Dependencies

```
easy-email-editor       ^4.16.6   ~3.7 MB
easy-email-extensions   ^4.16.5
easy-email-core         ^4.16.5
mjml                    ^4.15.3   ~600 KB
mjml-browser            ^4.15.3   client-friendly variant; preferred for the save pipeline
@arco-design/web-react  ^2.x       (Easy Email peer dep)
react-dnd               ^16.x      (Easy Email peer dep)
react-dnd-html5-backend ^16.x      (Easy Email peer dep)
```

## Risks

- **Bundle size**: Easy Email + Arco + mjml adds ~1.5 MB to the gzipped bundle. Acceptable because the dashboard is admin-only; mitigated by code-splitting `EmailDesigner` behind a dynamic import in `EmailDetail` / `EmailTemplateDetail`.
- **Arco Design styling**: Easy Email is built on Arco. Their design system is visible in tooltips/dropdowns inside the editor — call out in the PR. If it clashes, scope-reset Arco's CSS to the editor container only.
- **Bridge fidelity**: Existing Unlayer designs come back as a single non-decomposable HTML block. Users CAN keep editing the email by adding Easy Email blocks before/after, but can't surgically edit the legacy content without rebuilding. Document this in the PR.

## Verification

- `pnpm build` clean
- `pnpm dev` boots without console errors on `/dashboard/studio/email/messages`
- Open an existing Unlayer-shaped draft → bridge fires → email renders, can be saved → re-load → still renders
- Open a fresh email → drag in CTA + listing-card + footer → save → render output passes MJML validator
- Send a test email via the existing `onTestSend` flow → renders correctly in Gmail web

## Phasing

Single PR with all phases (they're interdependent — phase 1 alone would break the existing EmailDesigner contract):

1. Editor wrapper + brand theme
2. LE custom blocks
3. Legacy bridge
4. Save pipeline
5. Smoke test against existing templates + drafts
