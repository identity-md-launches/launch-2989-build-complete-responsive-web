// @ts-check
/**
 * Application state, polling and the alert store.
 *
 * Polling cadence follows the API's cache hints and rate classes:
 *   /status                 5 s   (publicFast, s-maxage 1 s)
 *   /events                10 s   (publicHeavy, s-maxage 5 s)
 *   /measurement/blocks    10 s   (observations, never cached)
 *   /measurement/runs      15 s   (observations, never cached)
 *   /measurement/stats     60 s   (s-maxage 60 s, also kept in localStorage)
 *   /settlements?range=24h 60 s   (s-maxage 60 s, also kept in localStorage)
 * Polling pauses while the tab is hidden and backs off after errors.
 */
import { getJson } from './api.js';
import { mergeEvents, describeEvent } from './derive.js';

/**
 * @typedef {{
 *   data: any, lastOkAt: number | null, lastTryAt: number | null,
 *   state: 'loading' | 'ok' | 'unavailable' | 'error',
 *   message: string | null, failures: number, fromCache: boolean
 * }} Resource
 */

/** @returns {Resource} */
const blank = () => ({ data: null, lastOkAt: null, lastTryAt: null, state: 'loading', message: null, failures: 0, fromCache: false });

const CACHE_PREFIX = 'squeek-radar.cache.v1.';
const ALERTS_KEY = 'squeek-radar.alerts.v1';
const NOTIFY_KEY = 'squeek-radar.notify.v1';
const MAX_ALERTS = 200;
const MAX_SAMPLES = 120;

/** @type {Record<string, { path: string, kind: any, every: number, cacheMs?: number }>} */
export const RESOURCES = {
  status: { path: '/status', kind: 'status', every: 5_000 },
  events: { path: '/events?category=measurement&limit=40', kind: 'events', every: 10_000 },
  blocks: { path: '/measurement/blocks', kind: 'blocks', every: 10_000 },
  runs: { path: '/measurement/runs?limit=20', kind: 'runs', every: 15_000 },
  stats: { path: '/measurement/stats?range=7d', kind: 'stats', every: 60_000, cacheMs: 60_000 },
  settlements: { path: '/settlements?range=24h', kind: 'settlements', every: 60_000, cacheMs: 60_000 },
};

/**
 * @typedef {{ id: string, type: string, title: string, occurredAt: string, detectedAt: string, read: boolean }} Alert
 */

export const state = {
  /** @type {Record<string, Resource>} */
  res: Object.fromEntries(Object.keys(RESOURCES).map((k) => [k, blank()])),
  /** All measurement events seen, newest first. */
  events: /** @type {any[]} */ ([]),
  /** Cursor for the next older page, or null when history is complete. */
  olderCursor: /** @type {string | null | undefined} */ (undefined),
  loadingOlder: false,
  olderError: /** @type {string | null} */ (null),
  /** Live readings collected during this session (real /status samples). */
  samples: /** @type {{ t: number, speed: number, rpmMilli: number }[]} */ ([]),
  alerts: loadAlerts(),
  notify: safeGet(NOTIFY_KEY) === 'on',
};

/** @type {Set<() => void>} */
const listeners = new Set();
/** @param {() => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit() {
  for (const fn of listeners) fn();
}

/** @param {string} k */
function safeGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
/** @param {string} k @param {string} v */
function safeSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

/** @returns {{ baselined: boolean, items: Alert[] }} */
function loadAlerts() {
  try {
    const raw = JSON.parse(safeGet(ALERTS_KEY) ?? 'null');
    if (raw && Array.isArray(raw.items)) return { baselined: !!raw.baselined, items: raw.items };
  } catch {
    /* ignore corrupt storage */
  }
  return { baselined: false, items: [] };
}
function saveAlerts() {
  safeSet(ALERTS_KEY, JSON.stringify(state.alerts));
}

/**
 * Record events as alerts, once per event id. On the very first load the
 * existing history becomes the baseline and is stored as already read, so
 * only events that arrive afterwards are new.
 * Older history pages are always stored as read.
 * @param {any[]} events
 * @param {boolean} [history] true for events from older pages
 * @returns {Alert[]} alerts created unread by this call
 */
export function ingestAlerts(events, history = false) {
  const known = new Set(state.alerts.items.map((a) => a.id));
  const baseline = !state.alerts.baselined || history;
  /** @type {Alert[]} */
  const fresh = [];
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || known.has(e.id)) continue;
    known.add(e.id);
    const a = {
      id: e.id,
      type: e.type,
      title: describeEvent(e).title,
      occurredAt: e.occurredAt,
      detectedAt: new Date().toISOString(),
      read: baseline,
    };
    state.alerts.items.push(a);
    if (!baseline) fresh.push(a);
  }
  if (!history) state.alerts.baselined = true;
  state.alerts.items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  state.alerts.items = state.alerts.items.slice(0, MAX_ALERTS);
  saveAlerts();
  return fresh;
}

/** @param {string} id */
export function markRead(id) {
  const a = state.alerts.items.find((x) => x.id === id);
  if (a) a.read = true;
  saveAlerts();
  emit();
}
export function markAllRead() {
  for (const a of state.alerts.items) a.read = true;
  saveAlerts();
  emit();
}
export function unreadCount() {
  return state.alerts.items.filter((a) => !a.read).length;
}

/** @param {boolean} on */
export function setNotify(on) {
  state.notify = on;
  safeSet(NOTIFY_KEY, on ? 'on' : 'off');
  emit();
}

/** @type {(alerts: Alert[]) => void} */
let onNewAlerts = () => {};
/** @param {(alerts: Alert[]) => void} fn */
export function onAlerts(fn) {
  onNewAlerts = fn;
}

/** @param {string} key @param {any} data */
function applyData(key, data) {
  if (key === 'events') {
    state.events = mergeEvents(state.events, data.events);
    if (state.olderCursor === undefined) state.olderCursor = data.nextCursor ?? null;
    const fresh = ingestAlerts(data.events);
    if (fresh.length) onNewAlerts(fresh);
  }
  if (key === 'status' && data.measurement) {
    const m = data.measurement;
    const t = Date.parse(m.observedAt);
    const last = state.samples[state.samples.length - 1];
    if (Number.isFinite(t) && (!last || last.t !== t)) {
      state.samples.push({ t, speed: Number(m.speedMmPerSecond), rpmMilli: Number(m.rpmMilli) });
      if (state.samples.length > MAX_SAMPLES) state.samples.shift();
    }
  }
}

/** @param {string} key */
export async function refresh(key) {
  const def = RESOURCES[key];
  const r = state.res[key];
  r.lastTryAt = Date.now();
  const result = await getJson(def.path, def.kind);
  if (result.kind === 'ok') {
    r.data = result.data;
    r.state = 'ok';
    r.lastOkAt = result.at;
    r.message = null;
    r.failures = 0;
    r.fromCache = false;
    applyData(key, result.data);
    if (def.cacheMs) safeSet(CACHE_PREFIX + key, JSON.stringify({ at: result.at, data: result.data }));
  } else if (result.kind === 'unavailable') {
    // Unknown, not empty: drop the old payload so nothing stale passes as current.
    r.data = null;
    r.state = 'unavailable';
    r.message = result.reason;
    r.failures = 0;
  } else {
    r.state = 'error';
    r.message = result.message;
    r.failures += 1;
  }
  emit();
  return result;
}

/**
 * Load cached historical stats so the first paint has them without a request.
 * Copies older than 10 minutes are ignored rather than shown as current.
 */
function hydrateCache() {
  for (const [key, def] of Object.entries(RESOURCES)) {
    if (!def.cacheMs) continue;
    try {
      const raw = JSON.parse(safeGet(CACHE_PREFIX + key) ?? 'null');
      if (raw && raw.data && typeof raw.at === 'number' && Date.now() - raw.at < 10 * 60_000) {
        const r = state.res[key];
        r.data = raw.data;
        r.lastOkAt = raw.at;
        r.state = 'ok';
        r.fromCache = true;
      }
    } catch {
      /* ignore */
    }
  }
}

/** @type {Record<string, ReturnType<typeof setTimeout>>} */
const timers = {};

/** @param {string} key @param {number} delay */
function schedule(key, delay) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => tick(key), delay);
}

/** @param {string} key */
async function tick(key) {
  if (document.hidden) return; // resumed by visibilitychange
  const def = RESOURCES[key];
  const result = await refresh(key);
  let delay = def.every;
  if (result.kind === 'error') {
    const r = state.res[key];
    delay = Math.min(60_000, def.every * 2 ** Math.min(r.failures, 4));
    if (result.retryAfterMs) delay = Math.max(delay, result.retryAfterMs);
  }
  schedule(key, delay);
}

/**
 * Walk older event pages once on start so milestones reflect the full
 * history the API serves (bounded to protect the rate limit).
 */
export async function loadOlderEvents(maxPages = 1) {
  if (state.loadingOlder) return;
  state.loadingOlder = true;
  state.olderError = null;
  emit();
  try {
    for (let i = 0; i < maxPages && state.olderCursor; i++) {
      const res = await getJson(
        `/events?category=measurement&limit=100&cursor=${encodeURIComponent(state.olderCursor)}`,
        'events',
      );
      if (res.kind !== 'ok') {
        state.olderError = res.kind === 'error' ? res.message : res.reason;
        break;
      }
      state.events = mergeEvents(state.events, res.data.events);
      ingestAlerts(res.data.events, true);
      state.olderCursor = res.data.nextCursor ?? null;
    }
  } finally {
    state.loadingOlder = false;
    emit();
  }
}

export async function start() {
  hydrateCache();
  emit();
  const now = Date.now();
  for (const [key, def] of Object.entries(RESOURCES)) {
    const r = state.res[key];
    const age = r.lastOkAt === null ? Infinity : now - r.lastOkAt;
    schedule(key, def.cacheMs && age < def.cacheMs ? def.cacheMs - age : 0);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const t = Date.now();
    for (const [key, def] of Object.entries(RESOURCES)) {
      const r = state.res[key];
      const due = r.lastTryAt === null || t - r.lastTryAt >= def.every;
      schedule(key, due ? 0 : def.every - (t - (r.lastTryAt ?? t)));
    }
  });
  // Fill in older history once the first page is in.
  const wait = setInterval(() => {
    if (state.olderCursor !== undefined) {
      clearInterval(wait);
      if (state.olderCursor) loadOlderEvents(5);
    }
  }, 500);
}
