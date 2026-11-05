// @ts-check
/**
 * Boot, hash routing, region patching and user interactions.
 * Hash routes (#/, #/live, #/events, #/milestones, #/rounds, #/alerts)
 * work on any static host or IPFS gateway subpath without rewrites.
 */
import { state, start, subscribe, emit, markRead, markAllRead, setNotify, unreadCount, loadOlderEvents, onAlerts } from './store.js';
import { VIEWS, liveFreshness } from './views.js';
import { freshBadge, updateRelTimes } from './ui.js';
import { clock, esc } from './format.js';

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const nav = /** @type {HTMLElement} */ (document.getElementById('nav'));
const headerStatus = /** @type {HTMLElement} */ (document.getElementById('header-status'));
const announcer = /** @type {HTMLElement} */ (document.getElementById('announcer'));

/** @type {import('./views.js').UiState} */
const ui = { filter: 'all' };
let current = VIEWS[0];
let firstRoute = true;

function routeFromHash() {
  const id = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0];
}

function renderNav() {
  const unread = unreadCount();
  const html = VIEWS.map((v) => {
    const href = v.id === 'dashboard' ? '#/' : `#/${v.id}`;
    const count = v.id === 'alerts' && unread ? ` <span class="nav-count">${unread}<span class="sr-only"> unread</span></span>` : '';
    return `<a href="${href}" class="nav-link" data-focus-key="nav-${v.id}" ${v === current ? 'aria-current="page"' : ''}>${esc(v.label)}${count}</a>`;
  }).join('');
  patch(nav, html);
  const f = liveFreshness();
  patch(headerStatus, `<span class="muted small">Live data</span>${freshBadge(f)}`);
}

/**
 * Replace an element's markup only when it changed, keeping keyboard focus.
 * @param {HTMLElement} el @param {string} html
 */
function patch(el, html) {
  if (/** @type {any} */ (el).__html === html) return;
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const key = active && el.contains(active) ? active.getAttribute('data-focus-key') : null;
  el.innerHTML = html;
  /** @type {any} */ (el).__html = html;
  if (key) {
    const again = /** @type {HTMLElement | null} */ (el.querySelector(`[data-focus-key="${CSS.escape(key)}"]`));
    if (again) again.focus({ preventScroll: true });
  }
  updateRelTimes(el);
}

function render() {
  renderNav();
  const regions = current.regions(ui);
  const keys = regions.map((r) => r.key).join('|');
  if (main.dataset.layout !== `${current.id}:${keys}`) {
    main.dataset.layout = `${current.id}:${keys}`;
    main.innerHTML = regions.map((r) => `<section class="region ${r.cls ?? ''}" data-region="${r.key}"></section>`).join('');
  }
  for (const r of regions) {
    const el = /** @type {HTMLElement | null} */ (main.querySelector(`[data-region="${r.key}"]`));
    if (el) patch(el, r.html);
  }
  tickCountdowns();
}

let queued = false;
function scheduleRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render();
  });
}

function onRoute() {
  current = routeFromHash();
  document.title = current.id === 'dashboard'
    ? "Squeek Radar: know what's happening on the wheel"
    : `${current.title} | Squeek Radar`;
  main.classList.remove('enter');
  void main.offsetWidth; // restart the entrance animation
  main.classList.add('enter');
  render();
  if (!firstRoute) {
    window.scrollTo({ top: 0 });
    /** @type {HTMLElement | null} */ (document.getElementById('page-title'))?.focus({ preventScroll: true });
  }
  firstRoute = false;
}

function tickCountdowns() {
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-countdown]')) {
    const end = Number(el.getAttribute('data-countdown'));
    const text = `${clock((end - now) / 1000)} left`;
    if (el.textContent !== text) el.textContent = text;
  }
}

document.addEventListener('click', (ev) => {
  const t = /** @type {HTMLElement} */ (ev.target);
  const el = /** @type {HTMLElement | null} */ (t.closest('[data-filter],[data-action]'));
  if (!el) return;
  const filter = el.getAttribute('data-filter');
  if (filter) {
    ui.filter = filter;
    render();
    return;
  }
  const action = el.getAttribute('data-action');
  if (action === 'older') loadOlderEvents(1);
  if (action === 'read') {
    // Move focus somewhere stable before the button disappears.
    const next = /** @type {HTMLElement | null} */ (el.closest('li')?.nextElementSibling?.querySelector('[data-action="read"]') ?? null);
    markRead(el.getAttribute('data-id') ?? '');
    if (next) {
      const key = next.getAttribute('data-focus-key');
      requestAnimationFrame(() => /** @type {HTMLElement | null} */ (document.querySelector(`[data-focus-key="${CSS.escape(key ?? '')}"]`))?.focus());
    } else {
      requestAnimationFrame(() => /** @type {HTMLElement | null} */ (document.getElementById('page-title'))?.focus());
    }
  }
  if (action === 'read-all') {
    markAllRead();
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (document.getElementById('page-title'))?.focus());
  }
  if (action === 'notify-off') setNotify(false);
  if (action === 'notify-on' && typeof Notification !== 'undefined') {
    Notification.requestPermission().then((p) => {
      setNotify(p === 'granted');
      announce(p === 'granted' ? 'Browser notifications turned on.' : 'Notification permission was not granted.');
    });
  }
});

/** @param {string} text */
function announce(text) {
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = text;
  }, 50);
}

onAlerts((fresh) => {
  announce(fresh.length === 1 ? `New event: ${fresh[0].title}` : `${fresh.length} new events`);
  if (state.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const a of fresh.slice(0, 3)) {
      try {
        new Notification('Squeek Radar', { body: a.title, tag: a.id, icon: './favicon.svg' });
      } catch {
        /* some mobile browsers only allow notifications from a service worker */
      }
    }
  }
});

subscribe(scheduleRender);
window.addEventListener('hashchange', onRoute);
setInterval(() => {
  updateRelTimes();
  tickCountdowns();
}, 1000);
// Freshness can change with time alone (a reading ages past its window).
setInterval(emit, 5000);

onRoute();
start();
