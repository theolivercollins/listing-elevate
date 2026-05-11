# Listing Elevate — Design Style Guide

> **A cinematic, editorial, almost-silent visual language.** Stark gallery surfaces.
> A single ink-black accent. Tight sans display headlines that act like film titles.
> Monospace as the dialect of "production metadata." Everything else, gets out of the way.

This guide reverse-engineers the hero so every new surface (onboarding, settings,
emails, decks) feels like it came from the same studio.

---

## 0 · The hero, decoded

> _— LISTING ELEVATE · CINEMATIC · ON DEMAND_
> # Take more listings.
> Upload photos. Receive a directed, edited, cinematic listing video within 72 hours. No crew, no scheduling, no post-production.
> [ Start a video → ]  [ Sign in to your account ↗ ]

The hero is **one full-bleed photograph, darkened, with a mono micro-eyebrow,
a 104px sans display headline (weight 500), a 18px humble paragraph, two CTAs
(one solid white pill, one underlined link), and a floating glass play disc.** Nothing
else. That restraint *is* the brand. When in doubt, do less.

The five moves that define every Listing Elevate surface:

1. **Editorial scale jumps.** 10px mono eyebrow → 104px display headline → 18px paragraph. Skip the in-between sizes.
2. **A horizontal hairline before every eyebrow** (`14–18px × 1px`). The dash that opens a film title card.
3. **Sans for everything. Mono for metadata.** Display headlines, body, buttons, labels — all Geist. IDs, durations, timestamps, eyebrows — JetBrains Mono.
4. **Hairline borders, never boxes.** Inputs underline, sections divide with `1px` solids, cards have no shadows.
5. **One photograph carries the mood.** Cinematic, slightly underexposed (`brightness(0.62) saturate(1.05)`), with a top-and-bottom dual-stop gradient so copy lands legibly.

**Two things we don't do:** italics, and a second display font. Instrument Serif is loaded only for one corner of the product (the wordmark in the toolbar). Treat it as off-limits everywhere else.

---

## 1 · Color

### 1.1 Token reference (from `styles.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--le-bg` | `#ffffff` | `#050710` | Page surface. Stark white / midnight navy. |
| `--le-bg-elev` | `#ffffff` | `#0b0f1c` | Elevated surface (same as bg in light — we lift via border, not fill). |
| `--le-bg-sunken` | `#f7f7f9` | `#02030a` | Sunken / inset wells. |
| `--le-border` | `rgba(10,12,20,0.07)` | `rgba(220,230,255,0.09)` | The default hairline. |
| `--le-border-strong` | `rgba(10,12,20,0.14)` | `rgba(220,230,255,0.18)` | Input underlines, section starts. |
| `--le-text` | `#07080c` | `#ffffff` | Headlines, primary copy. |
| `--le-text-muted` | `rgba(10,12,20,0.55)` | `rgba(255,255,255,0.62)` | Subheads, body, helper. |
| `--le-text-faint` | `rgba(10,12,20,0.30)` | `rgba(255,255,255,0.32)` | Section numbers, micro-labels, deprecated. |
| `--le-accent` | `#07080c` | `#ffffff` | Buttons, ink panels. **Brand "color" is ink.** |
| `--le-accent-fg` | `#ffffff` | `#050710` | Type on the accent. |

**Pure white (`#fff`) is for type on photographs, never as a fill on `--le-bg` (it disappears). Likewise pure black (`#000`) is reserved for image letterboxes — `#07080c` is the brand ink.**

### 1.2 The signature backgrounds

The two reusable backgrounds that anchor every page:

- **Gallery white** — `--le-bg`, light theme. Stark, art-museum, nothing more.
- **Midnight wash** (`.le-midnight-wash`) — the showcase slab. Stacked radial gradients of navy + cobalt + ink, layered over a deep blue-to-near-black vertical, with `0.08` fractal-noise overlay in `mix-blend-mode: overlay`. **Always pair it with white type.**

When a section needs to feel _important_ (showcase, hero, "the wow"), put the midnight wash behind it. When it needs to feel _trustworthy_ (forms, settings, status), keep it gallery-white.

### 1.3 The accent rule

The "accent" is **ink** — `#07080c` on light, `#fff` on dark. We don't tint
the UI with hue. The only place a non-ink color appears is:

- **Brand-kit accent picker** — five curated swatches the *agent* picks from. These are theirs, never ours.
- **Status colors** — success `oklch(0.62 0.15 155)`, warn `oklch(0.72 0.14 75)`, danger `oklch(0.58 0.17 25)`, info `oklch(0.6 0.13 240)`. Used only on badges and dots, never as fills.

**Never invent a new hue.** If you need a non-ink color, it's almost always a sign the layout is too weak.

---

## 2 · Type

### 2.1 The families

| Family | Stack | Used for |
|---|---|---|
| **Geist** (sans) | `"Geist", -apple-system, "Inter Tight", "Segoe UI", sans-serif` | **Everything visible.** Display headlines, body, headings, buttons, labels. |
| **JetBrains Mono** | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | Eyebrows, section numbers, MLS IDs, license #, timestamps, durations |
| **Instrument Serif** | `"Instrument Serif", "Playfair Display", "Times New Roman", serif` | **Reserved.** Only the wordmark "Elevate" in the toolbar (`var(--le-font-display)`). Not for use elsewhere. |

The single import:

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Serif stays in the bundle for the wordmark and historical pull-quote moments, but it is **not part of the system going forward.** New surfaces use Geist for everything that isn't mono.

### 2.2 The type scale (1440 canvas)

Pick from this scale. Do not interpolate. All Geist unless marked "mono."

| Token | Size | Line | Tracking | Weight | Used for |
|---|---:|---:|---:|---:|---|
| **Display XL** | 104–132px | 0.92–0.96 | -0.035em | 500 | Hero headlines ("Take more listings.") |
| **Display L** | 76–80px | 0.98 | -0.035em | 500 | Section headlines ("Three steps. Seventy-two hours.") |
| **Display M** | 56–64px | 0.98 | -0.030em | 500 | Onboarding section titles, "Your studio is open." |
| **Heading** | 34px | 1.0 | -0.025em | 500 | Card titles ("Upload", "Direct", "Deliver") |
| **Subhead** | 20–26px | 1.1 | -0.020em | 500 | Showcase card titles, section subhead |
| **Big stat** | 60px | 1.0 | -0.035em | 500 | "$380", "94.2%" |
| **Body L** | 18px | 1.50 | -0.005em | 400 | Hero paragraph |
| **Body** | 14px | 1.55–1.60 | 0 | 400 | Helper copy, descriptions |
| **Input value** | 17px | — | -0.010em | 500 | Filled form fields |
| **UI** | 13px | — | -0.005em | 500 | Buttons, nav |
| **Eyebrow** (mono) | 10–11px | — | **0.18–0.24em** | 500 | "— THE PROCESS" |
| **Meta** (mono) | 11–12px | — | 0.04–0.10em | 500 | Durations, IDs |
| **Footnote** | 10–11px | — | 0.04em | 400 | Copyright, timestamps |

**Weight 500 is the brand weight.** Geist 500 is used for every headline and most UI text. Weight 400 is for body and quiet helper copy. Weights 300 and 600 stay in the import but should not appear in designs.

**Letter-spacing is always tight.** Negative tracking on display (`-0.025` to `-0.035em`); zero or slightly negative on body; positive only on mono eyebrows and labels.

### 2.3 The two-clause headline

Both clauses are the same sans Geist 500. The break is structural, not stylistic — a line break and a period do the work.

```jsx
<h1 style={{ fontSize: 104, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.96 }}>
  Take more listings.
</h1>
```

For longer two-line cases:

```jsx
<h2 style={{ fontSize: 76, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98 }}>
  Three steps.<br/>Seventy-two hours.
</h2>
```

No italics. No color shift. No size change between clauses. The period at the end of each clause is non-negotiable — it's part of the cadence.

### 2.4 The eyebrow

Every section starts with one. Mono, 10–11px, `0.18–0.24em` tracking, uppercase,
`--le-text-faint`, preceded by a `14–18px × 1px` hairline (or an em-dash glyph
in marketing slabs).

```jsx
<div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-faint)", fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
  <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
  A concierge welcome
</div>
```

Or the marketing variant with an em-dash:

```jsx
<div className="le-eyebrow">— The Process</div>
```

### 2.5 The section-number rule

Sections are numbered in mono: `01`, `02`, `03` — zero-padded, `0.16–0.18em`
tracking, `--le-text-faint`. They sit on the same baseline as the section
headline, never above it. The number IS the visual marker — no icons, no chips, no fills.

```
02   Personal details          ← sans Display M 500, all on one baseline
```

In context-heavy lists ("01 / 03"), include the denominator after a forward slash:

```
02 / 03   ←  mono, faint
```

---

## 3 · Layout

### 3.1 The canvas

- **Desktop artboard:** `1440 × variable`. Native, never scaled.
- **Page padding:** `48px` horizontal (`64px` on hero / editorial surfaces).
- **Section vertical rhythm:** `140px` top + `120–140px` bottom on marketing slabs. `80–96px` on app surfaces. `48–72px` for compact density.
- **Inter-section gap (single-flow pages):** `96px` between numbered sections.
- **Inter-item gap:** `28px` for form columns, `20px` for grid cards, `14px` for tight choice rows.

### 3.2 The grids

| Grid | Cols | Use |
|---|---:|---|
| Form | 2 / 4 | Onboarding fields, listing details |
| Choice tiles | 3 / 4 | Voice picker, format picker, music beds |
| Marketing process | 3 (1px gap on hairline) | "Upload / Direct / Deliver" |
| Showcase | 1.3fr / 1fr split, with 1fr / 1fr stacked inside the right | Selected work |
| Stats | 2 × 2 | "By the numbers" |

### 3.3 The two-rail body

Long single-flow pages (onboarding, settings) use a **sticky progress rail + content**:

```
| 180px rail | 1fr content |
|------------|-------------|
| sticky     | scrolling   |
| step list  | sections    |
```

The rail is `48px` indented from the page edge, separated from content by a
`1px` `--le-border` divider. Each step is `mono number · hairline · sans label`,
14px gap between rows. The active step's hairline grows from `8px → 18px` and
its label goes from `--le-text-faint` → `--le-text`.

### 3.4 Hairlines, not boxes

The fundamental rule: **separate with lines, not with fills.**

- Inputs: `border: none; border-bottom: 1px solid var(--le-border-strong)`. No padding box, no rounded rectangle.
- Sections: divided by a thin top hairline (`1px solid var(--le-border)`), not by background bands.
- Cards: `1px` border, no shadow, no radius unless it's a media frame.
- Lists: `1px` row dividers; the hover state changes the background, not the border.

The exceptions where we DO use a fill:

- **The studio dashboard preview** (the wow moment) — full midnight ink panel, white type.
- **Marketing midnight slabs** — `.le-midnight-wash` background as a deliberate scene change.

### 3.5 Radii

| Token | Value | Use |
|---|---:|---|
| `--le-r-sm` | 6px | Nothing structural; tiny chip badges. |
| `--le-r-md` | 10px | Avoid. |
| `--le-r-lg` | 14px | The ink panel (`.le-ink-panel`). |
| `--le-r-xl` | 20px | Avoid. |

**Default radius is 0.** Buttons, inputs, cards, tiles all square-cornered.
Exceptions are: glass play disc (`50%`), small badge pills (`999px`), media frames inside the ink panel (`14px`), buttons with explicit `2–4px` softening.

### 3.6 Spacing scale

Use this scale; don't invent intermediates.

```
4 · 6 · 8 · 10 · 14 · 18 · 22 · 28 · 36 · 48 · 64 · 80 · 96 · 120 · 140
```

---

## 4 · Imagery

### 4.1 The photograph

Every editorial surface (hero, showcase, onboarding welcome) is anchored by
**one cinematic real-estate photograph**, treated as:

```css
filter: brightness(0.62) saturate(1.05);
```

Plus a **dual-stop gradient overlay** for legibility — darker at top (for the
nav) and at bottom (for copy), with a transparent middle:

```css
background: linear-gradient(180deg,
  rgba(5,7,16,0.85) 0%,
  rgba(5,7,16,0.15) 22%,
  rgba(5,7,16,0)    45%,
  rgba(5,7,16,0.35) 75%,
  rgba(5,7,16,0.7)  100%
);
```

The full hero uses five stops (above). A simpler three-stop variant
(`0.55 / 0.20 / 0.85`) works for shorter sections where the nav isn't overlaid.

### 4.2 Media frames

Cards displaying photo/video are `aspect-ratio` boxes with `objectFit: cover`,
`filter: brightness(0.82–0.9)` to settle the image into the page. They have
**no border, no radius**. A `1px` hairline only when they sit on a noisy background.

### 4.3 Placeholders

When we don't have a real asset, draw a placeholder, never a stock image:

- **Logo slot:** dashed-stroke square + a tiny ascending-bar mark inside.
- **Headshot slot:** dashed circle + simple head-and-shoulders silhouette in `--le-text-faint`.
- **Image card:** `.le-img-placeholder` — repeating 135° hairline pattern, mono caption inside.

---

## 5 · Components

### 5.1 Buttons

| Variant | Look | Use |
|---|---|---|
| **Primary (light)** | `bg: #07080c, fg: #fff, 16×22 padding, radius 0–2, 13–14px Sans 500` | "Enter the studio →" |
| **Primary (on photo)** | `bg: #fff, fg: #07080c, same metrics, radius 2–4` | Hero CTA |
| **Secondary** | `bg: transparent, border: 1px solid --le-border-strong, fg: --le-text-muted` | "Schedule a 10-min concierge call" |
| **Underlined link** | `color: inherit, text-decoration: underline, text-underline-offset: 4px` | "Sign in to your account" |
| **Glass** | `.le-btn-glass` — `linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))`, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.18)` | Floating CTAs on photo |
| **Icon button** | `34×34 square, 1px border rgba(255,255,255,0.22) on photo / --le-border on white, radius 6` | Theme toggle, settings |

All buttons: single-line, `gap: 6–10px` for an inline arrow, `letter-spacing: -0.005em`. Never uppercase. Always sentence case.

### 5.2 Form fields

```jsx
<div>
  <Label>First name<Req /></Label>   {/* 10px mono, 0.18em, uppercase, faint */}
  <input
    style={{
      width: "100%", marginTop: 10, padding: "10px 0",
      border: "none", borderBottom: "1px solid var(--le-border-strong)",
      fontSize: 17, fontWeight: 500, background: "transparent",
      color: "var(--le-text)", letterSpacing: "-0.01em", outline: "none",
    }}
  />
</div>
```

Rules:
- Label sits ABOVE, micro-mono.
- Field is `border-bottom` only.
- Filled value is **17px / weight 500** — heavier than body so it feels typeset.
- Required marker is `*` in `oklch(0.6 0.18 25)` (the danger soft), 4px gap.
- IDs / numbers (MLS, DRE, ZIP) use `font-family: var(--le-font-mono)`.
- Textareas inherit the same underline; `resize: vertical` only.
- Focus: bottom border darkens to `--le-text` (no glow, no ring on dark surfaces).

**Never** show a placeholder that mimics the value. Use a hint *below* the field if absolutely needed (`fontSize: 11, color: --le-text-faint`).

### 5.3 Choice tiles

Selection feels like a director picking a take, not a checkbox.

```
┌────────────────────────┐
│   [thin-stroke icon]   │   ← active: 1px solid --le-text
│   Warm female          │   ← inactive: 1px --le-border-strong
│   Scripted, conv'l.    │
└────────────────────────┘
```

- `padding: 20px 18px`
- Icon area is a **thin-stroke diagram** (not filled): aspect-ratio rectangles for output formats, mini-waveforms for voices, a circular play disc for music.
- Title 14px / 500, subtitle 11px / muted, 3px gap.
- Active state: border darkens to `--le-text`; no fill change.

### 5.4 The Concierge note

The luxury voice-over. Used sparingly — once per section at most.

```
─────────────────────────────────  ← top hairline 1px --le-border
⁂  CONCIERGE  We'll text you a single confirmation when each film is ready.
```

- Glyph `⁂` (asterism), sans, 18px, muted.
- `CONCIERGE` label mono, 9px, `0.2em`, faint, 8px gap before the body.
- Body 12px, muted, max-width 460.
- Padding `16px 0`, top hairline, no bottom hairline.
- **No italic body** — the concierge speaks in the same Geist as the rest of the product. The asterism + the all-caps mono label do the framing.

### 5.5 The ink panel ("wow")

Used once per flow, where the user lands after work. Pure ink, white type,
inset 16:10 dashboard mock, accent corner triangle.

```
.le-ink-panel: background #07080c, color #fff, radius 14, padding 32
```

Inside:
- Mono micro label ("Studio · Mara K.") top-left, mono "Live" top-right.
- Sans display headline (Geist 500, 38px, `-0.025em`) lower-left.
- 3-up stat grid with `1px rgba(255,255,255,0.18)` top hairlines.
- Accent triangle bottom-right: `linear-gradient(135deg, transparent 50%, [user accent] 50%)`, 80×80, opacity 0.8.

### 5.6 Progress rail (sticky)

```
SETUP                               ← eyebrow

01 ──── Welcome                     ← mono · short hairline · sans
02 ───────── Personal               ← active: 18px line, full opacity label
03 ──── Business
04 ──── Brand kit
05 ──── Voice & music
06 ──── Deliver

SAVED
Auto-saved a moment ago             ← bottom block, top hairline
```

- Container `180px` wide, sticky `top: 78px`, padding `80px 0 0 48px`.
- Right edge `1px --le-border` divider.
- Active row: line grows 8 → 18px (`transition: all .25s`), label `--text-faint` → `--text`.
- Done rows: label gets `text-decoration: line-through` in `--le-text-faint`.

### 5.7 Nav (sticky overlay)

```
[logo]  / Welcome                     Need help?  |  concierge@listingelevate.com
```

- Height ~`58px` (20 / 20 vertical padding).
- Background `color-mix(in oklab, var(--le-bg) 88%, transparent)`.
- `backdrop-filter: blur(20px)`.
- Bottom `1px --le-border`.
- Left: `LELogoMark` size 15 + mono micro-label `/ Section`.
- Right: support copy, dividers `1px × 12px` `--le-border-strong`.

On a photo hero, the nav is **transparent** and sits inside the photo's top
gradient — fonts switch to white with rgba opacity. Nav links are uppercase
mono 11px, `0.18em` tracked, `gap: 44px`.

### 5.8 Glass elements

Reserved for **floating UI over photography** — play discs, status pills,
duration badges. Three recipes in `styles.css`:

- `.le-glass` — light/dark adaptive, big enough to feel like a panel.
- `.le-glass-dark` — for things floating on the midnight wash.
- `.le-btn-glass` — buttons on photo heroes.

All use `backdrop-filter: blur(18–28px) saturate(1.4–1.6)`. Always pair with a faint inner top highlight (`inset 0 1px 0 rgba(255,255,255,0.25)`) — that's the "wet glass" cue.

### 5.9 Badges

`.le-badge` — pill, mono uppercase 11px, optional 5px dot in front.

State dots:
- Success: `oklch(0.62 0.15 155)` on `oklch(0.94 0.05 155)`
- Warn: `oklch(0.72 0.14 75)` on `oklch(0.95 0.05 75)`
- Danger: `oklch(0.58 0.17 25)` on `oklch(0.94 0.05 25)`
- Info: `oklch(0.6 0.13 240)` on `oklch(0.94 0.04 240)`

---

## 6 · Motion

The brand moves like film, not like a web app. Movements are short, eased,
and infrequent.

### 6.1 Timing

| Token | Duration | Easing | Used for |
|---|---:|---|---|
| micro | 150ms | `ease` | Button hover, link underline |
| short | 200ms | `cubic-bezier(.2, .6, .2, 1)` | Tab swap, input focus |
| section | 250ms | `cubic-bezier(.2, .6, .2, 1)` | Progress-rail row activation |
| reveal | 600–900ms | `cubic-bezier(.2, .8, .2, 1)` | Hero word swap, section enter |
| ambient | 1.6–2.5s | `linear` | Pulse, shimmer |

### 6.2 Named animations (in `styles.css`)

- `le-pulse` — opacity 1 → 0.35 → 1, 1.6s. Live dots, render-in-progress badges.
- `le-shimmer` — sliding 200% gradient over a sunken-to-elev gradient, 2.5s. Skeletons.
- `le-cascade`, `le-clapper`, `le-marquee-in`, `le-blur-in`, `le-glitch`, `le-caret` — the eight hero word-swap animations. The rest of the product is `le-cascade` or `le-marquee-in` only.
- `leWordIn` / `leWordOut` — the default fade-and-rise used for any text that has to swap.

### 6.3 Rules

- **No bouncy easings** anywhere. The brand is exhale, not boing.
- **No parallax** on photographs. Stillness reads as expensive.
- **No skeumorphic shadows.** Drop shadows are for the floating glass disc and nothing else.
- **Hover states** for choice tiles: border darkens; background may go to `--le-bg-sunken`; transform 0.

---

## 7 · Copywriting voice

The product is a concierge. Short clauses. Sentence case. Periods carry the cadence.
Numbers are spelled out for cadence ("Seventy-two hours") in headlines, numeric
("72h") in stats.

### 7.1 Tone rules

- **Lead with action, end with relief.** Two clauses, each ending with a period: "Take more listings." / "Three steps. Seventy-two hours."
- **Use "we" sparingly** — it's a concierge, not a corporation. Once per section.
- **No exclamation marks. Ever.**
- **No italics for emphasis.** The cadence and the punctuation do the work.
- **Never describe the product as "AI."** Describe it as a model, an editor, a director, a concierge.
- **Promise specifics.** "72 hours" not "fast." "94.2% accepted first cut" not "industry-leading."

### 7.2 Microcopy library

| Place | Use |
|---|---|
| Empty state hint | "Drop file or **browse**" (underline browse, not the whole phrase) |
| Field required | `*` only, never the word "required" |
| Save indicator | "Auto-saved a moment ago" / "Draft saved 2 min ago" |
| Error | Single sentence, mono "ERR" prefix, danger color, no exclamation. |
| Concierge interjection | "Don't have one? Your concierge can match a tone to your existing site." |
| Footer copyright | `© 2026 Listing Elevate — Concierge studio` |
| Eyebrows | Two words, all caps, separated by middle-dot if needed: "TRUSTED BY", "THE PROCESS", "BY THE NUMBERS" |

---

## 8 · Iconography

We use as few icons as we can get away with. When we must, they're
**thin-stroke, currentColor, 14–16px** — from the project's `LEIcon`
set: `play`, `arrow`, `arrowUpRight`, `sun`.

Forbidden:
- Filled icons in UI rows.
- Emoji.
- Colored icons.
- Icons inside text (use a hairline glyph or nothing).

When demonstrating a feature, **draw it instead** — the aspect-ratio diagrams
in the output picker, the mini-waveforms in the voice picker, the dashed
logo / headshot placeholders. Drawings beat icons.

---

## 9 · Worked patterns

### 9.1 Page skeleton (single-flow, app surface)

```
<sticky nav (transparent on photo, blurred on white)>
<hero — photograph OR editorial whitespace>
<two-rail body: progress rail | content>
  <section 02 · …>
  <section 03 · …>
  …
  <section N · ink "wow">
<footer — hairline, mono copyright>
```

### 9.2 Page skeleton (marketing)

```
<sticky transparent nav over hero photo>
<hero — full-bleed photo, dual-stop gradient, 104px sans headline>
<logo strip — 28px tall, hairline top & bottom>
<process — 3-up, 1px hairline dividers>
<showcase — midnight wash + media cards>
<by-the-numbers + quote — gallery white split>
<footer>
```

### 9.3 Form section

```
─── EYEBROW

02   Section title                       ← sans Display M 500
     Helper paragraph, 14px, muted, max 540

     LABEL              LABEL
     value              value            ← 2-up grid, 28px gap
     LABEL              LABEL
     value              value

     ⁂ CONCIERGE one-line note           ← optional, top hairline
```

---

## 10 · Forbidden patterns

A short list of things that immediately break the language. If you find yourself
reaching for one of these, redesign.

- ❌ **Italics. Anywhere.** No `font-style: italic`, no `<em>`. The cadence does the emphasis.
- ❌ **Serif type for body or headlines.** Instrument Serif is wordmark-only. Geist for everything else.
- ❌ **A second display font.** Geist + JetBrains Mono. That's the system.
- ❌ **Drop shadows on cards.** Use hairlines.
- ❌ **Gradients on text or buttons.** The gradient lives in the midnight wash and nowhere else.
- ❌ **Rounded corners >4px on UI** (chips, badges, the play disc are exceptions).
- ❌ **Hue accents** (orange CTAs, green ticks, blue links). Ink is the accent.
- ❌ **Emoji.**
- ❌ **Uppercase headlines.** Sentence case throughout. Uppercase belongs to mono eyebrows.
- ❌ **Boxed inputs.** Underline only.
- ❌ **Stock photography without the brightness/saturate treatment.**
- ❌ **A headline that ends in an exclamation mark.**
- ❌ **An icon next to a section number.** The number IS the icon.
- ❌ **"Industry-leading" / "AI-powered" / "next-gen."** Concrete or nothing.
- ❌ **A "Welcome to Listing Elevate" page.** The product is the welcome.

---

## 11 · Implementation cheat-sheet

```jsx
// Eyebrow
<div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-faint)", fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
  <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
  Section name
</div>

// Section number + sans display title
<div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
  <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 12, color: "var(--le-text-faint)", letterSpacing: "0.16em" }}>02</span>
  <h2 style={{ fontSize: 56, margin: 0, fontWeight: 500, letterSpacing: "-0.030em", lineHeight: 0.98 }}>
    Personal details
  </h2>
</div>

// Field
<div>
  <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--le-text-faint)", fontWeight: 500 }}>Mobile<span style={{ color: "oklch(0.6 0.18 25)", marginLeft: 4 }}>*</span></div>
  <input style={{ width: "100%", marginTop: 10, padding: "10px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", fontSize: 17, fontWeight: 500, background: "transparent", color: "var(--le-text)", letterSpacing: "-0.01em", outline: "none" }} />
</div>

// Hero headline — sans Geist 500, one period per clause, no italic
<h1 style={{ fontSize: 104, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.96, margin: 0 }}>
  Take more listings.
</h1>

// Photo treatment
<img style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.62) saturate(1.05)" }} />
<div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,7,16,0.85) 0%, rgba(5,7,16,0.15) 22%, rgba(5,7,16,0) 45%, rgba(5,7,16,0.35) 75%, rgba(5,7,16,0.7) 100%)" }} />

// Primary CTA on white
<button style={{ background: "var(--le-text)", color: "var(--le-bg)", border: "none", padding: "16px 22px", cursor: "pointer", fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em" }}>
  Enter the studio →
</button>
```

---

**One-line summary:** _Editorial photograph, hairline grid, ink sans type, mono metadata. No italics, no serif. If a screen feels too quiet, you got it right._
