# Phase 2 dashboard visual sample

Three self-contained HTML mockups (open directly in a browser — no build) demonstrating a reinvented, premium dashboard visual language for the logged-in app. This is a **design sample for sign-off**, not production code.

- `01-agent-home.html` — the agent (realtor) landing: latest-film hero, in-flight order with a 5-stage timeline + ETA, single primary CTA, stat tiles, recent orders.
- `02-operator-pipeline.html` — the operator cockpit: a "Needs you" triage strip, KPI tiles, and a dense ledger-style pipeline table.
- `03-shell-and-states.html` — the design system at a glance: color/type/radius/spacing scales, buttons, status chips, KPI tile, table row, **empty state**, **loading skeleton**, and a working light/dark toggle.

All three share one shell — same sidebar geometry, top bar, tokens, and component vocabulary — so they read as a single product. The agent and operator files carry their **real** navigation (agent: Home / Order a video / My listings / Billing / Profile; operator: Operate / Studio / Business), and the status chips use the **real** order vocabulary (Received → Rendering → In review → Delivered, plus Needs attention / Failed).

## Design decisions — and what's deliberately different from today

- **Same spine, calmer body.** The live accent `#2a6fdb` is kept exactly. What changed is the neutral stack: a cooler, more considered ink (`#0c0e16`) over a single page/surface pair, replacing the current warmer grays. The result feels quieter and more expensive without inventing a new brand color.
- **A distinctive active-nav treatment.** The active sidebar item keeps the ink-fill from today but gains a thin accent "spine" on its left edge — a small, recognizable signature that ties the whole system to the `#2a6fdb` accent without splashing blue everywhere.
- **The agent home leads with the film, not a list.** Today's agent home is section-stacked rows; here the newest delivered film is a proper hero (poster + runtime/scenes/delivered specs + Watch/Download/Share), and the in-flight order shows the real 5-stage timeline with a human ETA. The order of the page now answers "what's mine, what's ready, what's coming."
- **The operator gets a real triage surface.** A "Needs you" strip promotes the three exception types (scene review, failed render, ready-to-deliver) to the top with one-tap actions, above a dense **ledger-ruled** pipeline table (hairline rows, tabular numbers, inline mini-progress) — scannable at a glance instead of a kanban wall.
- **States are designed, not afterthoughts.** The system sheet ships an empty state with CTA and a shimmer loading skeleton as first-class components, so these never get hand-rolled per page.
- **Token discipline, honestly grounded.** Radius (8/10/14/18/pill), 4px spacing, three-step shadows, Inter-only type (no monospace anywhere), and semantic status colors map 1:1 to `docs/design/DESIGN-GUIDE.md` and `src/v2/styles/tokens.css`. The numbers shown are realistic sample values; no Helgemo branding, names, geography, or photos appear — neutral persona (Jordan Avery, Avery Group) and invented addresses throughout.

Rendered and visually verified (light and dark) before delivery.
