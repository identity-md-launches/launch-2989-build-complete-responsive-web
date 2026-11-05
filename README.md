# Squeek Radar: Live Activity & Event Monitor

**Know what's happening on the wheel.**

Squeek Radar is a public, read-only web app for watching the Squeekchain hamster wheel in real time. No NFT, staking, games or wallet needed. It reads only the public Squeekchain API.

## Features

| Section | Route | What it shows |
| --- | --- | --- |
| Dashboard | `#/` | Current activity, latest important event, latest milestone, block progress, recent events and a "What just happened?" summary built only from returned fields |
| Live activity | `#/live` | Core status, RPM, speed, today's distance, cumulative work units, last update, a Fresh / Stale / Unavailable badge, session speed chart, today's half-hour chart, 7-day chart, records, measurement runs |
| Event feed | `#/events` | Distance, daily distance, speed milestones, speed records and distance streaks, newest first, with a type filter and "Load older events" paging |
| Milestones | `#/milestones` | Distance, daily distance, speed and streak milestones, marked achieved only when an API event reports them |
| Rounds & blocks | `#/rounds` | 600 s round window and countdown, open/closed round work, oracle state, settlement pipeline, confirmed vs provisional block height, provisional blocks, confirmed settlements for the last 24 h |
| Alerts | `#/alerts` | One alert per new event id (no duplicates across reloads), timestamps, mark read / mark all read, optional browser notifications after the user grants permission |

## API integration

Base: `https://api.squeekchain.com/v1` (docs: https://docs.squeekchain.com/developers/api/). All requests are `GET` with no credentials (`src/js/api.js`).

| Endpoint | Poll | Used for |
| --- | --- | --- |
| `/status` | 5 s | live measurement, builder anchor/projection, oracle, settlement queue |
| `/events?category=measurement` | 10 s head refresh; cursor catch-up if events arrived while away; older pages once at start, up to 5 x 100 | feed, milestones, alerts |
| `/measurement/blocks` | 10 s | provisional blocks, round schedule (genesis timestamp) |
| `/measurement/runs` | 15 s at the retained tail cursor; 100-segment pages during catch-up | device-signed runs, labelled not SqueekCore-certified |
| `/measurement/stats?range=7d` | 60 s, cached in `localStorage` (used for 10 min) | today's distance, charts, records, round coverage |
| `/settlements?range=24h` | 60 s, cached in `localStorage` | confirmed settlements, round number anchor (`mining.nextRound`) |

Data rules:

- `{"status":"unavailable"}` responses and missing fields show "No data" or an explanation, never `0`.
- Each endpoint fails on its own. After a failed refresh the last good data stays, with a notice. Event-derived screens (including dashboard summaries, milestones and alerts) identify an unavailable event source and its reason alongside last-known history and the last successful check. Errors back off (up to 60 s) and honour `Retry-After`.
- Settlement snapshots preserve `X-Squeek-Settlement-Source`, `generatedAt` and the actual UTC window, including in the browser cache. A `durable-cache` fallback, expired window or snapshot older than two minutes is labelled **Stale** in both the settlement panel and dashboard summary. Missing snapshot times mean freshness is unknown. HTTP success and the time of the last check do not establish snapshot freshness. Confirmed history remains available when a later settlement request fails or reports unavailable. The header's Fresh / Stale badge refers to the wheel reading, independently of settlement freshness.
- Unknown `schemaVersion` values are rejected as errors, as the docs advise.
- Freshness: **Fresh** when the reading is newer than `staleAfterSeconds` and the API says `online`; **Stale** when the API says `stale`, the reading is too old, or polling has failed for longer than that window; **Unavailable** when there is no measurement.
- Measurement days run 12:00 to 12:00 UTC. "Today's distance" comes from the stats day that contains the current time.
- Round numbers appear only when tied to a round the API itself named (`settlements.mining.nextRound`); otherwise only the 600 s window is shown.
- Provisional data (builder projection, `/measurement/blocks`, unconfirmed submissions) is badged "Provisional". Only settlements with `confirmationStatus` `safe` or `finalized` are badged "Confirmed".
- Polling pauses while the tab is hidden.
- When polling resumes, event pages are fetched until they overlap previously seen events or reach the end. A failed catch-up retains its own retry cursor; it never replaces the cursor for older history. The feed and milestone radar claim complete history only when there is no pending gap. Recovered arrivals create unread alerts exactly once; older-history pages are read by default.
- Runs are oldest first at the API. Radar follows their opaque cursors until an empty page, keeps that tail cursor for later polls, merges by `segmentId` and shows the latest eight of up to 200 retained segments. Catch-up is explicitly labelled. Both cursor walks use batches of eight pages, 650 ms between pages and a one-second continuation between batches; other endpoints keep refreshing. Invalid run cursors restart from the first page.
- The current-round panel resolves settled failures and HTTP-success unavailable responses into an explanation with automatic retry; it shows a loader only while a source is actually loading.

## Stack

Plain ES modules, HTML and CSS with **no runtime or build dependencies** (JSDoc types checked by TypeScript). The site works from any static host or IPFS gateway subpath: every asset URL is relative and routing uses the URL hash.

```
src/            source (index.html, styles.css, js/*.js, favicon.svg, og-image.svg)
dist/           committed static export, a copy of src/
scripts/        build.mjs (src -> dist + checks), serve.mjs (local preview)
test/           node:test regressions, browser.mjs, captured real API fixtures
DESIGN.md       design system
artifacts/validation.md   checks run, review findings and limitations
```

## Setup

Requires Node 20 or newer.

```sh
npm install        # no dependencies; creates nothing but validates the lockfile
npm run dev        # serve src/ at http://localhost:4173/
npm run build      # rebuild dist/ from src/
npm run check:dist # confirm dist/ matches src/ and uses relative URLs
npm run preview    # serve dist/ at http://localhost:4173/
npm test           # unit tests
npm run typecheck  # tsc --noEmit over the JSDoc types (downloads TypeScript via npx)
```

Optional production browser validation uses Playwright as a testing tool, with
no application dependency. Install it locally without changing the lockfile:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

If Playwright is installed elsewhere, set `RADAR_PLAYWRIGHT` to its `index.mjs`;
`RADAR_BROWSER_EXECUTABLE` can select an existing Chromium binary. The test starts
and closes its own static server, serves `dist/` under `/preview/`, and writes
results/screenshots only to `test/scratch/`. It replays captured real API responses
and controlled test-only failures/arrivals; fixtures are never part of `dist/`.

## Deployment

The publish directory is `dist/`. There is no server code.

- **GitHub Pages:** push the repo, then Settings > Pages > Deploy from branch, folder `/dist` is not offered, so either use a Pages workflow that uploads `dist/` or publish `dist/` to a `gh-pages` branch (`git subtree push --prefix dist origin gh-pages`).
- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **IPFS:** pin the `dist/` folder; relative URLs and hash routes work under a gateway path.

## Validation

The revision was reproduced and checked locally. The production build, JSDoc
typecheck and source/export parity check passed; 29 unit/regression tests and
11 production browser scenarios passed. All six routes were checked at 320,
390, 768 and 1440 pixels, including populated settlement tables. Taste@1 passed
15 of 16 checks; the remaining flag identifies a normal navigation tab as a
heading label and is documented with screenshot evidence. See
[`artifacts/validation.md`](artifacts/validation.md) for commands, evidence,
the six-domain Better Interface review and limitations.

## GitHub delivery status

Public repository creation and push remain pending. This session provides no
GitHub connector or `gh` CLI, so no public repository URL is claimed. Completing
that external delivery requires authenticated GitHub access with permission to
create the public repository **squeek-radar** and upload this complete source and
the `dist/` export. Repository credentials and Git metadata were not accessed.

## License

MIT
