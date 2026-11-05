// @ts-check
/**
 * Pure formatting helpers. Nothing here touches the DOM or the network,
 * so every function is covered by test/format.test.mjs.
 *
 * Rule: a missing value (null, undefined, unparseable) never becomes zero.
 * Every formatter returns null for missing input; the UI renders that as
 * an explicit "No data" state.
 */

/** @param {unknown} v @returns {number | null} */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v @returns {bigint | null} */
export function big(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

const intFmt = new Intl.NumberFormat('en-US');

/** Group digits of an integer-like value. @param {unknown} v @returns {string | null} */
export function int(v) {
  const b = big(v);
  if (b !== null) return intFmt.format(b);
  const n = num(v);
  return n === null ? null : intFmt.format(Math.round(n));
}

/** @param {number} n @param {number} digits */
function fixed(n, digits) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Millimetres to a readable distance. @param {unknown} mm @returns {string | null} */
export function distance(mm) {
  const n = num(mm);
  if (n === null) return null;
  if (Math.abs(n) >= 1_000_000) return `${fixed(n / 1_000_000, 2)} km`;
  if (Math.abs(n) >= 1_000) return `${fixed(n / 1_000, 1)} m`;
  return `${fixed(n / 10, 1)} cm`;
}

/** Millimetres per second to km/h. @param {unknown} mmps @returns {string | null} */
export function speedKmh(mmps) {
  const n = num(mmps);
  return n === null ? null : `${fixed(n * 0.0036, 2)} km/h`;
}

/** @param {unknown} mmps @returns {string | null} */
export function speedMms(mmps) {
  const n = num(mmps);
  return n === null ? null : `${intFmt.format(Math.round(n))} mm/s`;
}

/** Thousandths of an RPM to RPM. @param {unknown} milli @returns {string | null} */
export function rpm(milli) {
  const n = num(milli);
  return n === null ? null : `${fixed(n / 1000, 1)} RPM`;
}

/** Basis points (0..10000) to a percentage. @param {unknown} bps @returns {string | null} */
export function pctBps(bps) {
  const n = num(bps);
  return n === null ? null : `${fixed(n / 100, n % 100 === 0 ? 0 : 1)}%`;
}

/**
 * SQK base units (18 decimals) to a readable token amount.
 * @param {unknown} base @returns {string | null}
 */
export function sqk(base) {
  const b = big(base);
  if (b === null) return null;
  const whole = b / 10n ** 18n;
  const frac = (b % 10n ** 18n) / 10n ** 16n; // two decimals, truncated
  return `${intFmt.format(whole)}.${frac.toString().padStart(2, '0')} SQK`;
}

/**
 * Fraction (0..1) of the way through the current Squeek block.
 * Block units are 1,000,000,000 per block.
 * @param {unknown} blockProgress @returns {number | null}
 */
export function blockFraction(blockProgress) {
  const b = big(blockProgress);
  if (b === null || b < 0n) return null;
  return Number(b % 1_000_000_000n) / 1_000_000_000;
}

/** @param {unknown} iso @returns {number | null} epoch ms */
export function ms(iso) {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Compact relative time. @param {number | null} then @param {number} now */
export function ago(then, now) {
  if (then === null) return null;
  const s = Math.round((now - then) / 1000);
  if (s < 0) return 'just now';
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Absolute UTC timestamp, e.g. "5 Nov, 08:22:00 UTC". @param {unknown} iso */
export function utc(iso) {
  const t = ms(iso);
  if (t === null) return null;
  const d = new Date(t);
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${d.getUTCDate()} ${month}, ${hh}:${mi}:${ss} UTC`;
}

/**
 * Squeekchain measurement days run 12:00 to 12:00 UTC and are named after
 * the UTC date on which they start. Returns that YYYY-MM-DD key.
 * @param {number} t epoch ms
 */
export function gameDay(t) {
  return new Date(t - 12 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Seconds as m:ss. @param {number} s */
export function clock(s) {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** Shorten a hash for display, keeping both ends. @param {unknown} h */
export function shortHash(h) {
  if (typeof h !== 'string' || h.length < 14) return typeof h === 'string' ? h : null;
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

/** "core_status" / "IDLE" to "Idle". @param {unknown} s */
export function humanize(s) {
  if (typeof s !== 'string' || !s) return null;
  const words = s.replace(/[._-]+/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** HTML-escape any value for safe interpolation. @param {unknown} v */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
