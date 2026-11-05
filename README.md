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
| `/events?category=measurement` | 10 s (older pages once at start, up to 5 x 100) | feed, milestones, alerts |
| `/measurement/blocks` | 10 s | provisional blocks, round schedule (genesis timestamp) |
| `/measurement/runs` | 15 s | device-signed runs, labelled not SqueekCore-certified |
| `/measurement/stats?range=7d` | 60 s, cached in `localStorage` (used for 10 min) | today's distance, charts, records, round coverage |
| `/settlements?range=24h` | 60 s, cached in `localStorage` | confirmed settlements, round number anchor (`mining.nextRound`) |

Data rules:

- `{"status":"unavailable"}` responses and missing fields show "No data" or an explanation, never `0`.
- Each endpoint fails on its own. After a failed refresh the last good data stays, with a "Refresh failed" notice. Errors back off (up to 60 s) and honour `Retry-After`.
- Unknown `schemaVersion` values are rejected as errors, as the docs advise.
- Freshness: **Fresh** when the reading is newer than `staleAfterSeconds` and the API says `online`; **Stale** when the API says `stale`, the reading is too old, or polling has failed for longer than that window; **Unavailable** when there is no measurement.
- Measurement days run 12:00 to 12:00 UTC. "Today's distance" comes from the stats day that contains the current time.
- Round numbers appear only when tied to a round the API itself named (`settlements.mining.nextRound`); otherwise only the 600 s window is shown.
- Provisional data (builder projection, `/measurement/blocks`, unconfirmed submissions) is badged "Provisional". Only settlements with `confirmationStatus` `safe` or `finalized` are badged "Confirmed".
- Polling pauses while the tab is hidden.

## Stack

Plain ES modules, HTML and CSS with **no runtime or build dependencies** (JSDoc types checked by TypeScript). The site works from any static host or IPFS gateway subpath: every asset URL is relative and routing uses the URL hash.

```
src/            source (index.html, styles.css, js/*.js, favicon.svg, og-image.svg)
dist/           committed static export, a copy of src/
scripts/        build.mjs (src -> dist + checks), serve.mjs (local preview)
test/           node:test unit tests for formatting, derivations and the API client
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

## Deployment

The publish directory is `dist/`. There is no server code.

- **GitHub Pages:** push the repo, then Settings > Pages > Deploy from branch, folder `/dist` is not offered, so either use a Pages workflow that uploads `dist/` or publish `dist/` to a `gh-pages` branch (`git subtree push --prefix dist origin gh-pages`).
- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **IPFS:** pin the `dist/` folder; relative URLs and hash routes work under a gateway path.

## Validation

See `artifacts/validation.md`. In short: in the session that produced this code the shell and browser tools were unavailable, so the build, tests, typecheck and browser checks were **not run**. Run the commands above before publishing.

## License

MIT
