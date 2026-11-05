// @ts-check
/**
 * The six screens: dashboard plus the five functional sections.
 * Each view returns named regions; main.js re-renders a region only when
 * its markup changes, so focus and scroll survive the live refresh.
 */
import { state, unreadCount } from './store.js';
import {
  esc, int, distance, speedKmh, speedMms, rpm, pctBps, sqk, blockFraction, ms, num, utc, clock, shortHash, humanize,
} from './format.js';
import {
  freshness, settlementFreshness, milestones, latestImportant, latestMilestone, roundWindow, todayFromStats, sortSettlements, summary, describeEvent, EVENT_TYPES, typeLabel,
} from './derive.js';
import {
  icon, badge, freshBadge, stat, card, loading, errorState, emptyState, gate, staleNotice, progress, eventItem, barChart, sparkline, txLink, coreStatusText, relTime, stamp,
} from './ui.js';

/** @typedef {{ key: string, cls?: string, html: string }} Region */
/** @typedef {{ id: string, label: string, title: string, ic: any, regions: (ui: UiState) => Region[] }} View */
/** @typedef {{ filter: string }} UiState */

const r = () => state.res;
const TABLE_HINT = '<p class="table-hint">Scroll the table sideways to see every column.</p>';
const now = () => Date.now();

export function liveFreshness() {
  return freshness(r().status.data?.measurement ?? null, r().status.lastOkAt, now());
}

/* ---------- shared blocks ---------- */

function liveBody(compact = false) {
  const res = r().status;
  const g = gate(res, 'live status');
  if (g) return g;
  const m = res.data.measurement;
  if (!m) {
    return errorState('No live measurement is reported right now.', `Reason from the API: ${humanize(res.data.builder?.reason) ?? 'not given'}. Values are unknown, not zero.`);
  }
  const f = liveFreshness();
  const today = todayFromStats(r().stats.data, now());
  const statsReady = !!r().stats.data;
  const todayValue = today.distanceMm !== null ? distance(today.distanceMm) : null;
  const todayHint = !statsReady
    ? 'Waiting for daily stats'
    : today.day
      ? `Day from ${esc(today.key)} 12:00 UTC, ${esc(pctBps(today.coverageBps) ?? 'unknown')} round coverage`
      : `No stats yet for the day from ${esc(today.key)} 12:00 UTC`;
  const stale = f !== 'fresh' ? `<p class="notice">${icon('clock', 'icon icon-sm')}These readings are ${f === 'stale' ? 'stale' : 'unavailable'}; the hamster may be doing something else now.</p>` : '';
  const head = `<div class="live-head">
      <div class="live-status ${m.coreStatus === 'ACTIVE' && f === 'fresh' ? 'is-running' : ''}">
        <span class="pulse" aria-hidden="true"></span>
        <span class="live-state">${esc(coreStatusText(m.coreStatus))}</span>
      </div>
      <div class="badges">${freshBadge(f)}${m.provenance && m.provenance !== 'hardware' ? badge(humanize(m.provenance) ?? '', 'warn') : ''}</div>
    </div>`;
  const stats = `<dl class="stats">
      ${stat('Wheel RPM', rpm(m.rpmMilli))}
      ${stat('Speed', speedKmh(m.speedMmPerSecond), esc(speedMms(m.speedMmPerSecond) ?? ''))}
      ${stat("Today's distance", todayValue, todayHint)}
      ${stat('Cumulative work units', int(m.cumulativeWorkUnits), 'Accepted measurements')}
      ${compact ? '' : stat('Counter distance', distance(m.distanceMm), 'Total on the current counter')}
      ${stat('Last updated', utc(m.observedAt), relTime(m.observedAt))}
    </dl>`;
  return head + stale + staleNotice(res) + stats;
}

function blockProgressBody() {
  const res = r().status;
  const g = gate(res, 'block progress');
  if (g) return g;
  const b = res.data.builder;
  if (!b || b.status !== 'available') {
    return errorState(`The block builder is unavailable (${humanize(b?.reason) ?? 'no reason given'}).`, 'Block height and progress are unknown until it returns.');
  }
  const a = b.anchor;
  const p = b.projected;
  const frac = blockFraction(p?.blockProgress);
  const perBlock = num(p?.workPerThousandBlocks);
  return `<div class="block-progress">
      <dl class="stats stats-2">
        ${stat('Confirmed block height', int(a?.blockHeight), `Settled through round ${esc(a?.settledThroughRound ?? 'unknown')}`)}
        ${stat('Provisional height', int(p?.blockHeight), 'Optimistic projection, not settled')}
      </dl>
      <p class="progress-label"><span>Progress to block ${esc(int(big1(p?.blockHeight)) ?? 'next')}</span><span class="num">${frac === null ? 'No data' : `${(frac * 100).toFixed(1)}%`}</span></p>
      ${progress(frac, 'Progress toward the next Squeek block')}
      <p class="muted small">${perBlock !== null ? `Threshold rate: ${esc(int(perBlock))} work units per 1,000 blocks. ` : ''}Provisional progress becomes final only when a settlement confirms on-chain.</p>
    </div>`;
}

/** @param {unknown} h next height = height + 1, as string */
function big1(h) {
  try {
    return typeof h === 'string' && /^\d+$/.test(h) ? (BigInt(h) + 1n).toString() : null;
  } catch {
    return null;
  }
}

function eventsGate() {
  const res = r().events;
  if (state.events.length) return null;
  const g = gate(res, 'events');
  if (g) return g;
  return emptyState('No measurement events have been reported yet.', 'New milestones and records appear here as soon as the API reports them.');
}

/** Shared source context for every view derived from the retained event history. */
function eventsNotice() {
  const res = r().events;
  const notices = [];
  if (res.state === 'unavailable' || res.state === 'error') {
    const status = res.state === 'unavailable' ? 'Events source is unavailable' : 'Events refresh failed';
    const checked = res.lastOkAt ? `last successful check ${stamp(new Date(res.lastOkAt).toISOString())}` : 'no successful check in this session';
    const retained = state.events.length || state.alerts.items.length;
    notices.push(`<p class="notice">${icon('alert', 'icon icon-sm')}<span>${status} (${esc(res.message)}). ${retained ? `Showing last-known history; ${checked}. ` : ''}Radar retries automatically.</span></p>`);
  }
  if (state.eventCatchup) notices.push(`<p class="notice">${icon('clock', 'icon icon-sm')}Checking for missed events. History coverage is incomplete until catch-up finishes; new alerts appear as events are recovered.</p>`);
  return notices.join('');
}

/** Confirmed settlement history remains useful even when its source is stale. */
function settlementsNotice(onlyWarning = false) {
  const res = r().settlements;
  if (!res.data) return '';
  const snapshot = res.snapshot;
  const f = settlementFreshness(snapshot, now());
  const failed = res.state === 'error' || res.state === 'unavailable';
  if (onlyWarning && !failed && f.freshness === 'fresh' && !res.fromCache) return '';
  const reasons = [...f.reasons];
  if (failed) reasons.push(`${res.state === 'unavailable' ? 'source unavailable' : 'refresh failed'}: ${res.message}`);
  if (res.fromCache) reasons.push('saved in this browser; awaiting an API check');
  const warning = failed || reasons.length || f.freshness === 'unavailable';
  return `${warning ? `<p class="notice">${icon('clock', 'icon icon-sm')}${failed || f.freshness === 'stale' ? 'Stale settlement snapshot' : 'Settlement freshness unknown'}${reasons.length ? ` (${esc(reasons.join('; '))})` : ''}. Showing last-known confirmed history. Radar retries automatically.</p>` : ''}
    <p class="muted small">Snapshot as of ${snapshot?.generatedAt ? stamp(snapshot.generatedAt) : 'an unreported time'}. Source: ${esc(snapshot?.source ?? 'not exposed by the API')}. Window: ${esc(utc(snapshot?.window?.startAt) ?? 'not reported')} to ${esc(utc(snapshot?.window?.endAt) ?? 'not reported')}. ${res.lastOkAt ? `Last successful check ${stamp(new Date(res.lastOkAt).toISOString())}.` : ''}</p>`;
}

/* ---------- views ---------- */

/** @type {View} */
const dashboard = {
  id: 'dashboard',
  label: 'Dashboard',
  title: 'Dashboard',
  ic: 'home',
  regions: () => {
    const imp = latestImportant(state.events);
    const ms_ = latestMilestone(state.events);
    const lines = summary({
      status: r().status.data,
      statusFresh: liveFreshness(),
      events: state.events,
      stats: r().stats.data,
      settlements: r().settlements.data,
      now: now(),
    });
    const evGate = eventsGate();
    return [
      {
        key: 'hero',
        cls: 'span-all hero',
        html: `<h1 id="page-title" tabindex="-1">Know what's happening on the wheel</h1>
          <p class="lede">Squeek Radar tracks the Squeekchain hamster live: activity, events, milestones and blocks. No wallet needed.</p>
          <div class="hero-actions"><a class="btn btn-primary" href="#/events">${icon('list')}Open live event feed</a><a class="btn" href="#/alerts">${icon('bell')}Alerts${unreadCount() ? ` (${unreadCount()} new)` : ''}</a></div>`,
      },
      {
        key: 'live',
        cls: 'span-2',
        html: card({ id: 'd-live', title: 'Hamster activity now', ic: 'wheel', meta: '<a class="more" href="#/live">Live details</a>', body: liveBody(true) }),
      },
      {
        key: 'summary',
        html: card({
          id: 'd-sum',
          title: 'What just happened?',
          ic: 'radar',
          body: eventsNotice() + settlementsNotice(true) + (lines.length
            ? `<ul class="summary">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
            : loading('summary')),
        }),
      },
      {
        key: 'important',
        html: card({
          id: 'd-imp',
          title: 'Latest important event',
          ic: 'trophy',
          body: eventsNotice() + (evGate ?? `<ul class="events">${eventItem(imp, { headingLevel: 3 })}</ul>`),
        }),
      },
      {
        key: 'milestone',
        html: card({
          id: 'd-ms',
          title: 'Latest milestone',
          ic: 'flag',
          meta: '<a class="more" href="#/milestones">Milestone radar</a>',
          body: eventsNotice() + (evGate ?? (ms_ ? `<ul class="events">${eventItem(ms_, { headingLevel: 3 })}</ul>` : emptyState('No milestone events yet.'))),
        }),
      },
      {
        key: 'blocks',
        html: card({ id: 'd-blk', title: 'Block progress', ic: 'cube', meta: '<a class="more" href="#/rounds">Round monitor</a>', body: blockProgressBody() }),
      },
      {
        key: 'recent',
        cls: 'span-all',
        html: card({
          id: 'd-recent',
          title: 'Recent events',
          ic: 'list',
          meta: '<a class="more" href="#/events">All events</a>',
          body: eventsNotice() + (evGate ?? `<ul class="events events-grid">${state.events.slice(0, 6).map((e) => eventItem(e, { headingLevel: 3, compact: true })).join('')}</ul>`),
        }),
      },
    ];
  },
};

/** @type {View} */
const live = {
  id: 'live',
  label: 'Live activity',
  title: 'Live activity',
  ic: 'activity',
  regions: () => {
    const stats = r().stats;
    const runs = r().runs;
    const speeds = state.samples.map((s) => s.speed);
    return [
      { key: 'head', cls: 'span-all', html: `<h1 id="page-title" tabindex="-1">Live activity</h1><p class="lede">Readings from the wheel sensor, refreshed every 5 seconds.</p>` },
      { key: 'now', cls: 'span-2', html: card({ id: 'l-now', title: 'Current status', ic: 'wheel', body: liveBody(false) }) },
      {
        key: 'spark',
        html: card({
          id: 'l-spark',
          title: 'Speed this session',
          ic: 'bolt',
          body: `${sparkline(speeds, 'Wheel speed over this session')}<p class="muted small">${state.samples.length} live readings collected since you opened Radar. Peak this session: ${esc(speeds.length ? speedKmh(Math.max(...speeds)) : 'no data')}.</p>`,
        }),
      },
      { key: 'today', cls: 'span-2', html: card({ id: 'l-today', title: 'Today by half hour', ic: 'clock', body: todayChart() }) },
      { key: 'records', html: card({ id: 'l-rec', title: 'Records, last 7 days', ic: 'trophy', body: recordsBody() }) },
      { key: 'week', cls: 'span-2', html: card({ id: 'l-week', title: 'Work per day, last 7 days', ic: 'calendar', meta: stats.data ? `<span class="muted small">Updated ${relTime(new Date(stats.lastOkAt ?? 0).toISOString())}</span>` : '', body: weekChart() }) },
      {
        key: 'runs',
        html: card({
          id: 'l-runs',
          title: 'Measurement runs',
          ic: 'activity',
          meta: badge('Not SqueekCore-certified', 'prov', 'info'),
          body: runsBody(runs),
        }),
      },
    ];
  },
};

function todayChart() {
  const res = r().stats;
  const g = gate(res, '7-day stats');
  if (g) return g;
  const t = todayFromStats(res.data, now());
  if (!t.day) return emptyState(`The stats do not include the day from ${t.key} 12:00 UTC yet.`, 'They refresh every minute.');
  const buckets = Array.isArray(t.day.buckets) ? t.day.buckets : [];
  const bars = buckets.map((/** @type {any} */ b) => {
    const mins = num(b.startMinuteUtc) ?? 0;
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} UTC`;
    const v = b.coverage === 'missing' || b.workUnits === null ? null : num(b.workUnits);
    return { label, value: v, title: `${label}: ${v === null ? 'no coverage' : `${int(v)} work units`}` };
  });
  return `${barChart(bars, `Work units per half hour for the measurement day from ${t.key}`)}
    <p class="legend"><span class="key key-bar"></span>Work units <span class="key key-missing"></span>No coverage (unknown, not zero)</p>
    ${staleNotice(res)}`;
}

function weekChart() {
  const res = r().stats;
  const g = gate(res, '7-day stats');
  if (g) return g;
  const days = res.data.activity?.days ?? [];
  const bars = days.map((/** @type {any} */ d) => {
    const covered = (num(d.coverage?.observedRoundCount) ?? 0) > 0;
    const v = covered ? num(d.observedWorkUnits) : null;
    return { label: d.date, value: v, title: `${d.date}: ${v === null ? 'no coverage' : `${int(v)} work units, ${distance(d.distanceMm) ?? 'distance not reported'}, ${pctBps(d.coverage?.coverageBps)} coverage`}` };
  });
  const cov = res.data.activity?.coverage;
  const rounds = res.data.rounds;
  return `${barChart(bars, 'Accepted work units per measurement day, last 7 days')}
    <p class="legend"><span class="key key-bar"></span>Work units <span class="key key-missing"></span>No coverage</p>
    <dl class="stats stats-3">
      ${stat('Round coverage', pctBps(cov?.coverageBps), cov ? `${int(cov.observedRoundCount)} of ${int(cov.expectedRoundCount)} rounds observed` : undefined)}
      ${stat('Active rounds', int(rounds?.activeCount), rounds ? `${int(rounds.zeroWorkCount)} with zero work, ${int(rounds.missingCount)} missing` : undefined)}
      ${stat('Lifetime distance', distance(res.data.lifetime?.observedDistanceMm), 'Accepted measurements')}
    </dl>
    ${staleNotice(res)}`;
}

function recordsBody() {
  const res = r().stats;
  const g = gate(res, 'records');
  if (g) return g;
  const rec = res.data.records ?? {};
  /** @param {string} label @param {any} x @param {(v:any)=>string|null} f */
  const row = (label, x, f) =>
    `<li><span class="rec-label">${esc(label)}</span><span class="rec-value num">${x ? esc(f(x.value) ?? 'No data') : '<span class="nodata">No data</span>'}</span>${x ? `<span class="muted small">${esc(utc(x.occurredAt) ?? '')}${x.coverage && x.coverage !== 'complete' ? `, ${esc(x.coverage)} coverage` : ''}</span>` : ''}</li>`;
  return `<ul class="records">
    ${row('Top speed', rec.peakObservedSpeedMmPerSecond, speedKmh)}
    ${row('Peak RPM', rec.peakObservedRpmMilli, rpm)}
    ${row('Best day distance', rec.maximumDailyDistanceMm, distance)}
    ${row('Most work in a half hour', rec.mostWorkHalfHour, (v) => (int(v) ? `${int(v)} units` : null))}
    ${row('Longest active window', rec.longestActiveWindowMinutes, (v) => (int(v) ? `${int(v)} min` : null))}
    ${row('Longest active-day streak', rec.longestActiveDayStreak, (v) => (int(v) ? `${int(v)} days` : null))}
  </ul>`;
}

/** @param {import('./store.js').Resource} res */
function runsBody(res) {
  const g = gate(res, 'measurement runs');
  if (g) return g;
  const d = res.data;
  const items = (d.items ?? []).slice().sort((/** @type {any} */ a, /** @type {any} */ b) => (ms(b.startAt) ?? 0) - (ms(a.startAt) ?? 0)).slice(0, 8);
  return `<p class="muted small">Device-signed segments (${esc(d.authority ?? 'unknown authority')}). Accepted measurements only; confirmed settlement is a separate step. Coverage ${esc(utc(d.coverageStartAt) ?? 'unknown')} to ${esc(utc(d.coverageThroughAt) ?? 'unknown')}.</p>
    ${state.runsCatchingUp ? `<p class="notice">${icon('clock', 'icon icon-sm')}Catching up with run history. Showing the latest collected segments; newer segments are still loading.</p>` : ''}
    ${d.freshness !== 'fresh' ? `<p class="notice">${icon('clock', 'icon icon-sm')}Runs feed is ${esc(d.freshness ?? 'of unknown freshness')}.</p>` : ''}
    ${items.length ? `<ul class="runs">${items.map((/** @type {any} */ it) => `<li><span class="num">${esc(int(it.workUnits) ?? 'No data')} units</span><span class="muted small">${esc(utc(it.startAt) ?? '')}${it.discontinuity ? ', after a gap' : ''}</span></li>`).join('')}</ul>` : emptyState('No runs on this page.')}
    ${staleNotice(res)}`;
}

/** @type {View} */
const events = {
  id: 'events',
  label: 'Event feed',
  title: 'Live event feed',
  ic: 'list',
  regions: (ui) => {
    const list = ui.filter === 'all' ? state.events : state.events.filter((e) => e.type === ui.filter);
    const evGate = eventsGate();
    const counts = Object.fromEntries(EVENT_TYPES.map((t) => [t.type, state.events.filter((e) => e.type === t.type).length]));
    const chips = [{ type: 'all', label: 'All' }, ...EVENT_TYPES]
      .map((t) => `<button type="button" class="chip" data-filter="${t.type}" data-focus-key="filter-${t.type}" aria-pressed="${ui.filter === t.type}">${esc(t.label)} <span class="chip-count">${t.type === 'all' ? state.events.length : counts[t.type]}</span></button>`)
      .join('');
    const older = state.olderCursor
      ? `<button type="button" class="btn" data-action="older" data-focus-key="older" ${state.loadingOlder ? 'disabled' : ''}>${state.loadingOlder ? 'Loading older events' : 'Load older events'}</button>`
      : state.olderCursor === null && !state.eventCatchup ? '<p class="muted small">You have reached the start of the event history.</p>' : '';
    return [
      { key: 'head', cls: 'span-all', html: `<h1 id="page-title" tabindex="-1">Live event feed</h1><p class="lede">Measurement events from the API, newest first. Checked every 10 seconds.</p>` },
      {
        key: 'feed',
        cls: 'span-all',
        html: card({
          id: 'e-feed',
          title: ui.filter === 'all' ? 'All measurement events' : typeLabel(ui.filter),
          ic: 'list',
          meta: r().events.lastOkAt ? `<span class="muted small">Checked ${relTime(new Date(r().events.lastOkAt ?? 0).toISOString())}</span>` : '',
          body: `<div class="chips" role="group" aria-label="Filter events by type">${chips}</div>
            ${eventsNotice()}
            ${evGate ?? (list.length ? `<ul class="events">${list.map((e) => eventItem(e)).join('')}</ul>` : emptyState(`No ${typeLabel(ui.filter).toLowerCase()} events have been reported.`, 'Choose All to see every event type.'))}
            <div class="feed-foot">${older}${state.olderError ? `<p class="error-text" role="alert">Could not load older events: ${esc(state.olderError)}. Try again.</p>` : ''}</div>`,
        }),
      },
    ];
  },
};

/** @param {any[]} list @param {string} key @param {(v:any)=>string|null} f @param {string} emptyMsg */
function ladder(list, key, f, emptyMsg) {
  if (!list.length) return emptyState(emptyMsg, 'A milestone is marked achieved only when an API event reports it.');
  return `<ol class="ladder">${list
    .map((e) => `<li>${icon('check', 'icon icon-ok')}<span class="ladder-value num">${esc(f(e.payload?.[key]) ?? 'No data')}</span><span class="muted small">first reached ${esc(utc(e.occurredAt) ?? '')}</span></li>`)
    .join('')}</ol>`;
}

/** @type {View} */
const radar = {
  id: 'milestones',
  label: 'Milestones',
  title: 'Milestone radar',
  ic: 'radar',
  regions: () => {
    const evGate = eventsGate();
    const m = milestones(state.events, now());
    const complete = state.olderCursor === null && !state.eventCatchup;
    const retained = r().events.state === 'error' || r().events.state === 'unavailable';
    const basis = `<p class="muted small">${retained ? `Based on ${state.events.length} events in last-known history.` : complete ? `Based on the full event history: ${state.events.length} events.` : `Based on ${state.events.length} events loaded so far. History coverage is incomplete.`}</p>`;
    /** @param {string} id @param {string} title @param {any} ic @param {string} body */
    const c = (id, title, ic, body) => card({ id, title, ic, body: evGate ?? body });
    return [
      { key: 'head', cls: 'span-all', html: `<h1 id="page-title" tabindex="-1">Milestone radar</h1><p class="lede">Distance, daily, speed and streak milestones the hamster has reached, taken only from reported events.</p>${eventsNotice()}${basis}` },
      { key: 'dist', html: c('m-dist', 'Lifetime distance', 'flag', ladder(m.distance, 'thresholdDistanceMm', distance, 'No lifetime distance milestones reported yet.')) },
      {
        key: 'daily',
        html: c('m-daily', 'Daily distance', 'calendar', `<p class="sub">Current day (from ${esc(m.today)}, 12:00 UTC)</p>
          ${ladder(m.dailyToday, 'thresholdDistanceMm', distance, 'No daily milestone reported for the current day yet.')}
          <p class="sub">Highest on any day</p>
          ${m.dailyAll.length ? `<p class="num">${esc(distance(m.dailyAll[m.dailyAll.length - 1].payload.thresholdDistanceMm))} on the day from ${esc(m.dailyAll[m.dailyAll.length - 1].payload.utcDate ?? 'unknown')}</p>` : '<p class="nodata">None reported</p>'}`),
      },
      {
        key: 'speed',
        html: c('m-speed', 'Speed', 'bolt', `${ladder(m.speed, 'thresholdSpeedMmPerSecond', speedKmh, 'No speed milestones reported yet.')}
          <p class="sub">Current speed record</p>
          ${m.currentRecord ? `<p class="num big">${esc(speedKmh(m.currentRecord.payload?.recordMmPerSecond) ?? 'No data')}</p><p class="muted small">Set ${esc(utc(m.currentRecord.occurredAt) ?? '')}, ${m.records.length} record${m.records.length === 1 ? '' : 's'} so far</p>` : '<p class="nodata">No speed record reported</p>'}`),
      },
      {
        key: 'streak',
        html: c('m-streak', 'Activity streak', 'flame', m.longestStreak
          ? `<p class="num big">${esc(int(m.longestStreak.payload?.days) ?? 'No data')} days</p><p class="muted small">At least ${esc(distance(m.longestStreak.payload?.minimumDailyDistanceMm) ?? 'an unreported distance')} each day, ending ${esc(m.longestStreak.payload?.endingUtcDate ?? 'unknown')}</p>`
          : emptyState('No distance streak has been reported yet.', 'Streaks appear after consecutive measurement days meet the daily minimum.')),
      },
      {
        key: 'records',
        cls: 'span-all',
        html: c('m-rec', 'Speed record history', 'trophy', m.records.length
          ? `<ol class="ladder">${m.records.map((e) => `<li>${icon('trophy', 'icon icon-ok')}<span class="ladder-value num">${esc(speedKmh(e.payload?.recordMmPerSecond) ?? 'No data')}</span><span class="muted small">${esc(describeEvent(e).description)} ${esc(utc(e.occurredAt) ?? '')}</span></li>`).join('')}</ol>`
          : emptyState('No speed records reported yet.')),
      },
    ];
  },
};

/** @type {View} */
const rounds = {
  id: 'rounds',
  label: 'Rounds & blocks',
  title: 'Round and block monitor',
  ic: 'cube',
  regions: () => [
    { key: 'head', cls: 'span-all', html: `<h1 id="page-title" tabindex="-1">Round and block monitor</h1><p class="lede">Rounds last 600 seconds. ${badge('Provisional', 'prov')} data is accepted measurement only; ${badge('Confirmed', 'conf', 'check')} data has settled on-chain.</p>` },
    { key: 'round', html: card({ id: 'r-round', title: 'Current round', ic: 'clock', body: roundBody() }) },
    { key: 'pipeline', html: card({ id: 'r-pipe', title: 'Settlement pipeline', ic: 'activity', body: pipelineBody() }) },
    { key: 'blocks', html: card({ id: 'r-blk', title: 'Block height', ic: 'cube', body: blockProgressBody() }) },
    { key: 'prov', cls: 'span-all', html: card({ id: 'r-prov', title: 'Provisional blocks', ic: 'cube', meta: badge('Provisional, no SQK issued', 'prov'), body: provBody() }) },
    { key: 'settled', cls: 'span-all', html: card({ id: 'r-set', title: 'Confirmed settlements, last 24 hours', ic: 'check', meta: badge('Confirmed on-chain', 'conf', 'check'), body: settlementsBody() }) },
  ],
};

function roundBody() {
  const st = r().status.data;
  const blocks = r().blocks.data;
  const nr = r().settlements.data?.mining?.nextRound;
  const w = roundWindow({ genesisTimestamp: blocks?.roundSchedule?.genesisTimestamp, anchorRound: nr?.round, anchorStartsAt: nr?.startsAt }, now());
  if (!w && !st) {
    /** @type {[string, import('./store.js').Resource][]} */
    const sources = [['Status', r().status], ['Blocks', r().blocks], ['Settlements', r().settlements]];
    if (sources.some(([, res]) => res.state === 'loading')) return loading('round data');
    const reasons = sources.filter(([, res]) => res.message).map(([label, res]) => `${label}: ${res.message}`).join('. ');
    return errorState('Round data is unavailable.', `${reasons || 'The API has not reported a round schedule'}. Radar retries automatically.`);
  }
  const q = st?.builder?.status === 'available' ? st.builder.queued : null;
  const oc = st?.oracle;
  return `${w ? `<p class="progress-label"><span>${w.round ? `Round ${esc(int(w.round))}` : 'Current round window'}</span><span class="num" data-countdown="${w.endsAt}">${clock(w.remaining)} left</span></p>
      ${progress(w.fraction, 'Time elapsed in the current round')}
      <p class="muted small">${esc(utc(new Date(w.startsAt).toISOString()))} to ${esc(utc(new Date(w.endsAt).toISOString()))}${w.round ? '' : '. Round number shown once settlements load.'}</p>` : '<p class="nodata">Round schedule not reported</p>'}
    <dl class="stats stats-2">
      ${stat('Work in open round', q ? int(q.openRoundWorkUnits) : null, 'Provisional')}
      ${stat('Closed, unsettled rounds', q ? int(q.closedRoundCount) : null, q ? `${esc(int(q.closedWorkUnits))} work units waiting` : undefined)}
      ${stat('Oracle state', humanize(oc?.state), oc?.latestClosure ? `Latest closure: round ${esc(oc.latestClosure.lastRound)}` : undefined)}
      ${stat('Settled through round', st?.builder?.anchor ? int(st.builder.anchor.settledThroughRound) : null, 'Confirmed')}
    </dl>`;
}

function pipelineBody() {
  const res = r().status;
  const g = gate(res, 'settlement pipeline');
  if (g) return g;
  const q = res.data.settlementQueue;
  if (!q || q.status !== 'available') return errorState(`Settlement queue is unavailable (${humanize(q?.reason) ?? 'no reason given'}).`);
  const s = q.latestSubmission;
  const confirmed = s && s.confirmedAt;
  return `<p class="pipeline-state">${badge(humanize(q.state) ?? 'Unknown', q.state === 'blocked' || q.incidentOpen ? 'warn' : 'info')}${q.settlementEnabled ? '' : badge('Settlement disabled', 'warn')}</p>
    ${s ? `<dl class="stats stats-2">
      ${stat('Latest submission', `Rounds ${s.previousSettledThroughRound} to ${s.settledThroughRound}`, confirmed ? badge('Confirmed', 'conf', 'check') : badge(`${humanize(s.lifecycle) ?? 'Pending'}, not confirmed`, 'prov'))}
      ${stat('Submitted', utc(s.submittedAt), relTime(s.submittedAt))}
      ${stat('Expected block height', int(s.expected?.blockHeight), 'Until confirmed, this is provisional')}
      ${stat('Transaction', s.transactionHash ? shortHash(s.transactionHash) : null, s.transactionHash ? txLink(s.transactionHash, 'View on Etherscan') : undefined)}
    </dl>` : emptyState('No settlement submission yet.')}
    ${q.blockedReason ? `<p class="notice">${icon('alert', 'icon icon-sm')}Blocked: ${esc(humanize(q.blockedReason))}</p>` : ''}`;
}

function provBody() {
  const res = r().blocks;
  const g = gate(res, 'provisional blocks');
  if (g) return g;
  const d = res.data;
  const list = d.blocks ?? [];
  const head = `<p class="muted small">Up to 120 blocks beyond the settled frontier, projected from accepted measurements. Feed freshness: ${esc(d.freshness ?? 'unknown')}. Anchor: block ${esc(int(d.anchor?.blockHeight) ?? 'unknown')}, confirmed ${esc(utc(d.anchor?.confirmedAt) ?? 'at an unknown time')}.</p>`;
  if (!list.length) return head + emptyState('No provisional blocks beyond the settled frontier right now.', 'They appear when accepted work crosses the next block threshold.') + staleNotice(res);
  return `${head}${TABLE_HINT}<div class="table-wrap" tabindex="0" role="region" aria-label="Provisional blocks table"><table>
    <thead><tr><th scope="col">Block</th><th scope="col">Work threshold</th><th scope="col">Round</th><th scope="col">Completing passage</th><th scope="col">Status</th></tr></thead>
    <tbody>${list.slice().reverse().map((/** @type {any} */ b) => `<tr><td class="num">${esc(int(b.height) ?? 'No data')}</td><td class="num">${esc(int(b.workThreshold) ?? 'No data')}</td><td class="num">${esc(int(b.roundId) ?? 'No data')}</td><td>${b.completingAt ? esc(utc(b.completingAt)) : '<span class="nodata">Not covered by passage evidence</span>'}</td><td>${badge('Provisional', 'prov')}</td></tr>`).join('')}</tbody>
  </table></div>${staleNotice(res)}`;
}

function settlementsBody() {
  const res = r().settlements;
  const g = res.data ? null : gate(res, 'settlements');
  if (g) return g;
  const d = res.data;
  const list = sortSettlements(d.recentSettlements ?? []);
  const sum = d.summary ?? {};
  const bars = (d.buckets ?? []).map((/** @type {any} */ b) => {
    const label = `${utc(b.startAt)?.split(', ')[1]?.slice(0, 5) ?? ''} UTC`;
    return { label, value: num(b.workAdded), title: `${utc(b.startAt)}: ${int(b.workAdded) ?? 'no data'} work units settled in ${int(b.settlementCount) ?? 'unknown'} settlements` };
  });
  return `${settlementsNotice()}<dl class="stats stats-4">
      ${stat('Settlements', int(sum.settlementCount))}
      ${stat('Work settled', int(sum.workAdded), 'Work units')}
      ${stat('Blocks completed', int(sum.completedBlockCount))}
      ${stat('Safe through Ethereum block', int(d.chain?.safeThroughBlock), `${esc(int(d.chain?.confirmations) ?? 'unknown')} confirmations`)}
    </dl>
    <h3 class="sub">Work settled per hour</h3>
    ${barChart(bars, 'Work units settled per hour, last 24 hours', { height: 80 })}
    <h3 class="sub">Recent settlements with work</h3>
    ${list.length ? `${TABLE_HINT}<div class="table-wrap" tabindex="0" role="region" aria-label="Recent settlements table"><table>
      <thead><tr><th scope="col">Time</th><th scope="col">Rounds</th><th scope="col">Work added</th><th scope="col">Blocks</th><th scope="col">SQK issued</th><th scope="col">Status</th><th scope="col">Transaction</th></tr></thead>
      <tbody>${list.map((/** @type {any} */ s) => `<tr><td>${esc(utc(s.blockTimestamp) ?? 'No data')}</td><td class="num">${esc(s.previousSettledThroughRound)} to ${esc(s.settledThroughRound)}</td><td class="num">${esc(int(s.workAdded) ?? 'No data')}</td><td class="num">${s.firstCompletedBlock ? `${esc(int(s.firstCompletedBlock))} to ${esc(int(s.lastCompletedBlock))}` : '<span class="muted">None</span>'}</td><td class="num">${esc(sqk(s.sqkMintedBaseUnits) ?? 'No data')}</td><td>${s.confirmationStatus === 'safe' || s.confirmationStatus === 'finalized' ? badge(`Confirmed (${s.confirmationStatus})`, 'conf', 'check') : badge(humanize(s.confirmationStatus) ?? 'Unknown', 'prov')}</td><td>${txLink(s.transactionHash, shortHash(s.transactionHash) ?? 'tx')}</td></tr>`).join('')}</tbody>
    </table></div>` : emptyState('No settlements in the last 24 hours.')}
    ${staleNotice(res)}`;
}

/** @type {View} */
const alerts = {
  id: 'alerts',
  label: 'Alerts',
  title: 'Alert center',
  ic: 'bell',
  regions: () => {
    const items = state.alerts.items;
    const unread = unreadCount();
    const supported = typeof Notification !== 'undefined';
    const perm = supported ? Notification.permission : 'unsupported';
    const notify = !supported
      ? '<p class="muted">This browser does not support notifications.</p>'
      : perm === 'denied'
        ? '<p class="muted">Notifications are blocked for this site. Allow them in your browser settings to turn them on.</p>'
        : state.notify && perm === 'granted'
          ? `<p>Browser notifications are on for new events.</p><button type="button" class="btn" data-action="notify-off" data-focus-key="notify">Turn off notifications</button>`
          : `<p class="muted">Get a system notification when a new event arrives while Radar is open. Your browser will ask for permission.</p><button type="button" class="btn btn-primary" data-action="notify-on" data-focus-key="notify">${icon('bell')}Turn on notifications</button>`;
    return [
      { key: 'head', cls: 'span-all', html: `<h1 id="page-title" tabindex="-1">Alert center</h1><p class="lede">Each new event creates one alert, even across reloads. Alerts are stored only in this browser.</p>` },
      {
        key: 'list',
        cls: 'span-2',
        html: card({
          id: 'a-list',
          title: unread ? `Alerts (${unread} unread)` : 'Alerts',
          ic: 'bell',
          meta: unread ? `<button type="button" class="btn btn-sm" data-action="read-all" data-focus-key="read-all">Mark all as read</button>` : '',
          body: eventsNotice() + (!items.length
            ? (state.events.length || r().events.state === 'ok'
              ? emptyState('No alerts yet.', 'New events will show up here while Radar is open.')
              : gate(r().events, 'events') ?? loading('alerts'))
            : `<ul class="alerts">${items
              .slice(0, 100)
              .map((a) => `<li class="alert ${a.read ? 'is-read' : 'is-unread'}">
                <span class="alert-dot" aria-hidden="true"></span>
                <div class="alert-body"><h3 class="event-title">${esc(a.title)}</h3>
                <p class="event-meta">${a.read ? badge('Read', 'info') : badge('New', 'conf')} <span class="tag">${esc(typeLabel(a.type))}</span> Event ${stamp(a.occurredAt)}</p></div>
                ${a.read ? '' : `<button type="button" class="btn btn-sm" data-action="read" data-id="${esc(a.id)}" data-focus-key="read-${esc(a.id)}">Mark read<span class="sr-only">: ${esc(a.title)}</span></button>`}
              </li>`)
              .join('')}</ul>`),
        }),
      },
      { key: 'notify', html: card({ id: 'a-notify', title: 'Browser notifications', ic: 'bell', body: notify }) },
    ];
  },
};

export const VIEWS = [dashboard, live, events, radar, rounds, alerts];
