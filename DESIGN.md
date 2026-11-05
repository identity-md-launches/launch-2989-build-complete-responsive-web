# Squeek Radar design system

Source of truth: `src/styles.css` (tokens in `:root`) and the HTML-string components in `src/js/ui.js`. `dist/` is a copy. The final export was inspected in Chromium at 320, 390, 768 and 1440px (see `artifacts/validation.md`). This revision preserves the existing layout and palette.

## Overview

A dark, data-dense monitoring dashboard for a public audience who want to see what the hamster is doing right now. Hierarchy: one page heading, then cards; each card has a small icon heading and its data. Numbers are the content, so they get the larger sizes and tabular figures; labels and hints stay small and muted. Purple marks primary actions, active navigation and accents; blue marks links and secondary chart elements. Status is always a text badge, never color alone.

## Colors (`src/styles.css` `:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#070a14` | page background (with two soft radial purple/blue glows on `body`) |
| `--surface` | `#0e1324` | cards, nav bar |
| `--surface-2` | `#151b33` | buttons, active nav item, progress track |
| `--line` | `#242c4a` | card and control borders, table dividers |
| `--text` | `#e8ebf7` | primary text |
| `--muted` | `#9aa3c0` | labels, hints, secondary text, "No data" |
| `--purple` | `#a78bfa` | accent text, icons, tags, unread dots |
| `--purple-strong` | `#7c3aed` | primary button fill, chart bars, nav count |
| `--blue` | `#60a5fa` | links, sparkline, empty-state icon |
| `--blue-strong` | `#2563eb` | gradient end (progress bar, favicon) |
| `--focus` | `#c4b5fd` | focus ring |
| `--ok-bg` / `--ok-fg` | `#0d2a22` / `#6ee7b7` | Fresh, Confirmed, New |
| `--warn-bg` / `--warn-fg` | `#2e2208` / `#fcd34d` | Stale, warnings, notices |
| `--bad-bg` / `--bad-fg` | `#321317` / `#fca5a5` | Unavailable, errors |
| `--prov-bg` / `--prov-fg` | `#1f1840` / `#c4b5fd` | Provisional, pressed chip |
| `--info-bg` / `--info-fg` | `#13203d` / `#93c5fd` | neutral state badges (Read, queue state) |

Badge fills are solid so text contrast can be measured. Contrast ratios were calculated from the hex values, not measured in a rendered page.

## Typography

- Family: `--font` = Inter if installed, else the system UI stack. No web font is bundled, so most users see their system sans-serif. `--mono` is used only for transaction hash links.
- Six sizes only: `--fs-xs` 0.8125rem (badges, hints, axis labels), `--fs-sm` 0.875rem (labels, nav, buttons, meta), `--fs-md` 1rem (body, card and event titles), `--fs-lg` 1.25rem (stat values, brand), `--fs-xl` 1.75rem (h1 on mobile, live state, big numbers), `--fs-2xl` 2.25rem (h1 from 48rem).
- Three weights: 400 body and missing-data text, 600 labels/buttons/card titles/stat values, 700 brand/h1/big numbers. No intermediate 500 or 650 weights.
- Line height 1.5 body, 1.15 h1, 1.25 to 1.35 titles. h1 letter-spacing -0.02em; nothing else is tracked and nothing is uppercase.
- `font-variant-numeric: tabular-nums` on every changing number (`.stat-value`, `.num`, `.kv dd`, counts).
- Ledes are capped at 60ch, event descriptions at 65ch; headings use `text-wrap: balance`.

## Layout

- Shell: `.shell`, max 84rem, inline padding 1rem.
- Spacing scale `--s1`..`--s7`: 4, 8, 12, 16, 24, 32, 48px.
- `main` is a grid of `.region` sections: 1 column below 48rem, 2 columns from 48rem, 3 columns from 72rem. `.span-2` spans two columns (full width at 2 columns), `.span-all` spans the row.
- Nav: 3 x 2 grid of 44px links on phones, a single wrapping row from 48rem.
- `.stats` grids: 2 columns on phones, 3 from 36rem; `.stats-2` and `.stats-4` variants.
- Tables sit in `.table-wrap` (`position: relative`, horizontal scroll inside the card, keyboard-focusable) with a "Scroll the table sideways" hint below 60rem. Relative positioning contains absolute screen-reader text from transaction links inside the scrolling table. All six routes were observed without page-level horizontal scrolling at 320, 390, 768 and 1440px; populated tables retain all their columns and scroll locally.
- Long values wrap with `overflow-wrap: anywhere`.

## Elevation & depth

Flat. Cards are `--surface` with a 1px `--line` border and no shadow. Depth comes from the tonal step bg > surface > surface-2. The only shadow is the inset 2px purple underline on the active nav item and the pulse ring on the live dot.

## Shapes

`--radius` 16px for cards and the nav bar, 12px for buttons, nav items and event icons, 999px for badges, chips, progress bars and counts, `--radius-sm` 10px for the skip link.

## Components (`src/js/ui.js` unless noted)

- `card({id,title,ic,meta,body})`: `<article>` labelled by its `h2`; `meta` sits at the right of the header (a link, badge or timestamp).
- `stat(label, value, hint)`: `dt`/`dd` pair inside a `dl.stats`; null value renders italic muted "No data".
- `badge(text, tone, icon)` and `freshBadge(f)`: tones `fresh`, `stale`, `off`, `prov`, `conf`, `info`, `warn`.
- `eventItem(e, {compact})`: icon tile, `h3` title, type tag, absolute UTC time plus relative time, description and payload values (hidden when compact).
- `barChart(bars)`: SVG bars; `null` values draw as dashed "no coverage" slots, never as zero bars. `sparkline(values)` for session samples.
- `progress(fraction, label)`: `role="progressbar"` with a gradient fill.
- `loading`, `errorState`, `emptyState`, `gate(resource)`, `staleNotice(resource)`: the standard loading / unavailable / error / kept-data states.
- `eventsNotice()` (`views.js`): shared warning on event-derived views, with the API's reason, a last-known-history label and the last successful check. During cursor catch-up it states that coverage is incomplete. Warning text, including inline timestamps, stays inside one span next to its icon so it wraps as a sentence.
- `settlementsNotice()` (`views.js`): confirmed-history context independent of the wheel's live badge. Shows snapshot source, generated/as-of time, UTC window and last successful check; durable-cache or expired/old snapshots use the existing warning color and explicit Stale text. `store.js` persists the metadata with cached settlement data.
- `relTime` / `stamp`: `<time data-rel>` filled every second by `main.js`, so markup stays stable between polls.
- Buttons (`styles.css`): `.btn`, `.btn-primary` (one per view), `.btn-sm`; 44px min height (40px for `.btn-sm`), hover only under `(hover: hover)`, press `scale(0.96)`.
- Filter chips: `.chip` buttons with `aria-pressed`.
- Nav (`src/js/main.js` `renderNav`): links with `aria-current="page"` and an unread count.

Interaction: `main.js` re-renders a region only when its markup changes and restores focus by `data-focus-key`. Route changes move focus to the page `h1`. The skip link focuses and scrolls the existing `main` without changing the hash route. New alerts are announced in a polite `role="status"` region.

## Motion

Route entrance: regions rise 8px and fade in over 0.45s, staggered 40ms, only under `prefers-reduced-motion: no-preference` (reduced motion gets a 0.2s fade). The live dot pulse and spinner run only under no-preference. Transitions name their properties (no `transition: all`), 150ms for controls.

## Do's and don'ts

- Start a new page as a `View` in `src/js/views.js`: a `span-all` head region with one `h1#page-title` and a lede, then `card()` regions.
- Render missing data with `stat(..., null)` or `emptyState`, never `0`.
- Label anything not settled on-chain with `badge('Provisional','prov')`; use `conf` only for confirmed settlements.
- Use only the six `--fs-*` sizes and the existing color tokens; add no new accent colors.
- Keep one `.btn-primary` per view. No uppercase or tracked labels above headings.

Design review used the pinned Better Interface guide, adapted from Jakub Krehel
(MIT), with documentation guidance adapted from Paul Bakaus's Impeccable
(Apache-2.0). Source attribution and review coverage are recorded in
`artifacts/validation.md`.
