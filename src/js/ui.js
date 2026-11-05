// @ts-check
/**
 * Reusable HTML-string components. Every interpolated API value passes
 * through esc(). Relative times render as empty <time data-rel> elements
 * that main.js fills each second, so the markup itself stays stable and
 * a region is only re-rendered when its data changes.
 */
import { esc, utc, ago, ms, humanize } from './format.js';
import { describeEvent, typeLabel } from './derive.js';

/** Inline SVG icon set (24px grid, stroke icons). */
const ICONS = {
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z"/>',
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  link: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
};

/** @param {keyof typeof ICONS} name @param {string} [cls] */
export function icon(name, cls = 'icon') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** @param {unknown} iso */
export function relTime(iso) {
  const t = ms(iso);
  if (t === null) return '<span class="nodata">No time reported</span>';
  return `<time data-rel datetime="${esc(iso)}" title="${esc(utc(iso))}"></time>`;
}

/** Absolute and relative time together. @param {unknown} iso */
export function stamp(iso) {
  const t = ms(iso);
  if (t === null) return '<span class="nodata">No time reported</span>';
  return `<span class="stamp">${esc(utc(iso))} <span class="muted">(${relTime(iso)})</span></span>`;
}

/** Fill every relative-time element; called once per second. */
export function updateRelTimes(root = document) {
  const now = Date.now();
  for (const el of root.querySelectorAll('time[data-rel]')) {
    const t = ms(el.getAttribute('datetime'));
    const text = ago(t, now) ?? '';
    if (el.textContent !== text) el.textContent = text;
  }
}

/**
 * Badge with text, so status never relies on color alone.
 * @param {string} text @param {'fresh'|'stale'|'off'|'prov'|'conf'|'info'|'warn'} tone
 * @param {keyof typeof ICONS} [ic]
 */
export function badge(text, tone, ic) {
  return `<span class="badge badge-${tone}">${ic ? icon(ic, 'icon icon-sm') : ''}${esc(text)}</span>`;
}

/** @param {'fresh'|'stale'|'unavailable'} f */
export function freshBadge(f) {
  if (f === 'fresh') return badge('Fresh', 'fresh', 'check');
  if (f === 'stale') return badge('Stale', 'stale', 'clock');
  return badge('Unavailable', 'off', 'alert');
}

/**
 * Labelled value. Null shows an explicit "No data" instead of zero.
 * @param {string} label @param {string | null | undefined} value @param {string} [hint]
 */
export function stat(label, value, hint) {
  const v = value === null || value === undefined || value === ''
    ? '<span class="nodata">No data</span>'
    : esc(value);
  return `<div class="stat"><dt>${esc(label)}</dt><dd><span class="stat-value">${v}</span>${hint ? `<span class="stat-hint">${hint}</span>` : ''}</dd></div>`;
}

/** Card wrapper with a heading and optional right-side meta. */
export function card(/** @type {{ id?: string, title: string, level?: number, meta?: string, body: string, cls?: string, ic?: keyof typeof ICONS }} */ o) {
  const h = `h${o.level ?? 2}`;
  return `<article class="card ${o.cls ?? ''}" ${o.id ? `aria-labelledby="${o.id}"` : ''}>
    <header class="card-head"><${h} class="card-title" ${o.id ? `id="${o.id}"` : ''}>${o.ic ? icon(o.ic) : ''}${esc(o.title)}</${h}>${o.meta ? `<div class="card-meta">${o.meta}</div>` : ''}</header>
    ${o.body}
  </article>`;
}

/** Loading placeholder. @param {string} what */
export function loading(what) {
  return `<div class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading ${esc(what)}</div>`;
}

/** @param {string} msg @param {string} [next] */
export function errorState(msg, next) {
  return `<div class="state state-error">${icon('alert')}<div><p>${esc(msg)}</p>${next ? `<p class="muted">${esc(next)}</p>` : ''}</div></div>`;
}

/** @param {string} msg @param {string} [next] */
export function emptyState(msg, next) {
  return `<div class="state state-empty">${icon('info')}<div><p>${esc(msg)}</p>${next ? `<p class="muted">${next}</p>` : ''}</div></div>`;
}

/**
 * Standard handling of a resource: loading, unavailable, error without data.
 * Returns markup when the resource cannot be rendered, or null to proceed.
 * When an error follows earlier success, data is kept and a notice is shown.
 * @param {import('./store.js').Resource} r @param {string} what
 */
export function gate(r, what) {
  if (r.state === 'unavailable') return errorState(`${what} is unavailable from the API (${r.message}).`, 'This is unknown data, not zero. Radar retries automatically.');
  if (r.data) return null;
  if (r.state === 'error') return errorState(`Could not load ${what}: ${r.message}.`, 'Radar retries automatically with backoff.');
  return loading(what);
}

/** Notice for kept data after a failed refresh, or cached data. @param {import('./store.js').Resource} r */
export function staleNotice(r) {
  if (r.state === 'error' && r.data) {
    return `<p class="notice">${icon('clock', 'icon icon-sm')}Refresh failed (${esc(r.message)}). Showing data loaded ${relTime(new Date(r.lastOkAt ?? 0).toISOString())}.</p>`;
  }
  return '';
}

/** Progress bar with a text value. @param {number | null} fraction @param {string} label */
export function progress(fraction, label, tone = 'accent') {
  if (fraction === null) return '<p class="nodata">Progress not reported</p>';
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return `<div class="progress progress-${tone}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}"><span style="inline-size:${pct.toFixed(2)}%"></span></div>`;
}

/** @param {string} tone */
function toneIcon(tone) {
  return tone === 'speed' ? 'bolt' : tone === 'streak' ? 'flame' : tone === 'distance' ? 'flag' : 'info';
}

/**
 * One event row.
 * @param {any} e @param {{ headingLevel?: number, compact?: boolean }} [o]
 */
export function eventItem(e, o = {}) {
  const d = describeEvent(e);
  const h = `h${o.headingLevel ?? 3}`;
  const iconName = e.type === 'measurement.speed_record' ? 'trophy' : e.type === 'measurement.daily_distance_milestone' ? 'calendar' : toneIcon(d.tone);
  const values = o.compact
    ? ''
    : `<dl class="kv">${d.values.map((v) => `<div><dt>${esc(v.label)}</dt><dd>${esc(v.value)}</dd></div>`).join('')}</dl>`;
  return `<li class="event event-${d.tone}">
    <span class="event-icon">${icon(/** @type {any} */ (iconName))}</span>
    <div class="event-body">
      <${h} class="event-title">${esc(d.title)}</${h}>
      <p class="event-meta"><span class="tag">${esc(typeLabel(e.type))}</span> ${stamp(e.occurredAt)}</p>
      ${o.compact ? '' : `<p class="event-desc">${esc(d.description)}</p>`}
      ${values}
    </div>
  </li>`;
}

/**
 * Bar chart as SVG. Null values draw as a dashed "no coverage" slot, never as zero.
 * @param {{ label: string, value: number | null, title: string }[]} bars
 * @param {string} name accessible chart name
 */
export function barChart(bars, name, { height = 120 } = {}) {
  if (!bars.length) return emptyState('Nothing to chart yet.');
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0));
  const w = 100 / bars.length;
  const gap = Math.min(1.2, w * 0.2);
  const rects = bars.map((b, i) => {
    const x = i * w + gap / 2;
    const bw = w - gap;
    if (b.value === null) {
      return `<rect class="bar-missing" x="${x}" y="${height - 12}" width="${bw}" height="10" rx="1"><title>${esc(b.title)}</title></rect>`;
    }
    const bh = b.value === 0 ? 1.5 : Math.max(3, (b.value / max) * (height - 4));
    return `<rect class="bar" x="${x}" y="${height - bh}" width="${bw}" height="${bh}" rx="1"><title>${esc(b.title)}</title></rect>`;
  });
  const first = bars[0]?.label ?? '';
  const last = bars[bars.length - 1]?.label ?? '';
  return `<figure class="chart"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(name)}">${rects.join('')}</svg>
    <figcaption class="chart-axis"><span>${esc(first)}</span><span>${esc(last)}</span></figcaption></figure>`;
}

/** Sparkline of real samples. @param {number[]} values @param {string} name */
export function sparkline(values, name) {
  if (values.length < 2) return '<p class="muted small">Collecting live samples. The chart fills in as readings arrive.</p>';
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(38 - (v / max) * 34).toFixed(2)}`);
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(name)}"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Explorer link for a Sepolia transaction. @param {unknown} hash @param {string} text */
export function txLink(hash, text) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return '<span class="nodata">No transaction</span>';
  return `<a class="mono-link" href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noopener noreferrer">${esc(text)}${icon('link', 'icon icon-sm')}<span class="sr-only"> (opens Etherscan in a new tab)</span></a>`;
}

/** @param {unknown} s */
export function coreStatusText(s) {
  if (s === 'ACTIVE') return 'Running';
  if (s === 'IDLE') return 'Idle';
  if (s === 'COUNTER_FAULT') return 'Counter fault';
  return humanize(s);
}
