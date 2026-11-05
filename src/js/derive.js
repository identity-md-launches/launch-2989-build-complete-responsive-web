// @ts-check
/**
 * Pure derivations from API payloads. No DOM, no network, no clock reads:
 * callers pass `now`, so test/derive.test.mjs can pin every case.
 */
import { distance, speedKmh, speedMms, ms, gameDay, num, big, int, ago } from './format.js';

export const ROUND_SECONDS = 600;

/** The five measurement event types the brief asks for, in display order. */
export const EVENT_TYPES = [
  { type: 'measurement.distance_milestone', label: 'Distance milestones' },
  { type: 'measurement.daily_distance_milestone', label: 'Daily distance' },
  { type: 'measurement.speed_milestone', label: 'Speed milestones' },
  { type: 'measurement.speed_record', label: 'Speed records' },
  { type: 'measurement.distance_streak', label: 'Distance streaks' },
];

/**
 * Freshness of the live measurement.
 * - unavailable: no measurement has ever been loaded, or the API reports none
 * - stale: the API says stale, the reading is older than staleAfterSeconds,
 *          or our last successful poll is older than that window
 * - fresh: otherwise
 * @param {any} measurement status.measurement (may be null)
 * @param {number | null} lastOkAt epoch ms of the last successful /status poll
 * @param {number} now
 * @returns {'fresh' | 'stale' | 'unavailable'}
 */
export function freshness(measurement, lastOkAt, now) {
  if (!measurement || lastOkAt === null) return 'unavailable';
  const windowMs = (num(measurement.staleAfterSeconds) ?? 120) * 1000;
  const observed = ms(measurement.observedAt);
  if (measurement.freshness === 'stale') return 'stale';
  if (observed === null || now - observed > windowMs) return 'stale';
  if (now - lastOkAt > windowMs) return 'stale';
  return 'fresh';
}

/** @param {string} type */
export function typeLabel(type) {
  const found = EVENT_TYPES.find((t) => t.type === type);
  return found ? found.label : type.replace(/^measurement\./, '').replace(/_/g, ' ');
}

/**
 * Human title, description and values for one event, using only its payload.
 * @param {any} e
 * @returns {{ title: string, description: string, values: {label:string, value:string}[], tone: 'distance'|'speed'|'streak'|'other' }}
 */
export function describeEvent(e) {
  const p = e && typeof e.payload === 'object' && e.payload ? e.payload : {};
  const nd = 'not reported';
  switch (e?.type) {
    case 'measurement.distance_milestone':
      return {
        title: `Lifetime distance passed ${distance(p.thresholdDistanceMm) ?? nd}`,
        description: 'The wheel counter crossed a lifetime distance milestone.',
        values: [
          { label: 'Milestone', value: distance(p.thresholdDistanceMm) ?? nd },
          { label: 'Observed lifetime distance', value: distance(p.observedLifetimeDistanceMm) ?? nd },
        ],
        tone: 'distance',
      };
    case 'measurement.daily_distance_milestone':
      return {
        title: `Daily distance passed ${distance(p.thresholdDistanceMm) ?? nd}`,
        description: `Distance for the measurement day starting ${p.utcDate ?? 'on an unreported date'} at 12:00 UTC crossed a milestone.`,
        values: [
          { label: 'Milestone', value: distance(p.thresholdDistanceMm) ?? nd },
          { label: 'Observed day distance', value: distance(p.observedDayDistanceMm) ?? nd },
          { label: 'Measurement day', value: typeof p.utcDate === 'string' ? p.utcDate : nd },
        ],
        tone: 'distance',
      };
    case 'measurement.speed_milestone':
      return {
        title: `Speed passed ${speedKmh(p.thresholdSpeedMmPerSecond) ?? nd}`,
        description: 'A wheel speed reading crossed a speed milestone.',
        values: [
          { label: 'Milestone', value: speedLine(p.thresholdSpeedMmPerSecond) },
          { label: 'Observed speed', value: speedLine(p.observedSpeedMmPerSecond) },
        ],
        tone: 'speed',
      };
    case 'measurement.speed_record': {
      const prev = num(p.previousRecordMmPerSecond);
      const rec = num(p.recordMmPerSecond);
      const gain = prev !== null && rec !== null ? speedMms(rec - prev) : null;
      return {
        title: `New speed record: ${speedKmh(p.recordMmPerSecond) ?? nd}`,
        description: gain
          ? `Beat the previous record of ${speedKmh(prev) ?? nd} by ${gain}.`
          : 'The fastest reading so far.',
        values: [
          { label: 'New record', value: speedLine(p.recordMmPerSecond) },
          { label: 'Previous record', value: speedLine(p.previousRecordMmPerSecond) },
        ],
        tone: 'speed',
      };
    }
    case 'measurement.distance_streak':
      return {
        title: `Distance streak: ${int(p.days) ?? nd} days`,
        description: `At least ${distance(p.minimumDailyDistanceMm) ?? nd} on each measurement day, ending ${p.endingUtcDate ?? 'on an unreported date'}.`,
        values: [
          { label: 'Streak length', value: p.days != null ? `${int(p.days)} days` : nd },
          { label: 'Daily minimum', value: distance(p.minimumDailyDistanceMm) ?? nd },
          { label: 'Ending day', value: typeof p.endingUtcDate === 'string' ? p.endingUtcDate : nd },
        ],
        tone: 'streak',
      };
    default:
      return {
        title: typeLabel(String(e?.type ?? 'Unknown event')),
        description: 'This event type is newer than this version of Squeek Radar, so its values are shown as reported.',
        values: Object.entries(p).map(([k, v]) => ({ label: k, value: String(v) })),
        tone: 'other',
      };
  }
}

/** @param {unknown} mmps */
function speedLine(mmps) {
  const k = speedKmh(mmps);
  return k ? `${k} (${speedMms(mmps)})` : 'not reported';
}

/**
 * Merge event lists by id, newest first. Later copies of an id replace earlier ones.
 * @param {any[]} existing @param {any[]} incoming
 */
export function mergeEvents(existing, incoming) {
  const byId = new Map();
  for (const e of existing) if (e && typeof e.id === 'string') byId.set(e.id, e);
  for (const e of incoming) if (e && typeof e.id === 'string') byId.set(e.id, e);
  return [...byId.values()].sort(
    (a, b) => (ms(b.occurredAt) ?? 0) - (ms(a.occurredAt) ?? 0) || String(b.id).localeCompare(String(a.id)),
  );
}

/**
 * Milestones supported by real events only. Nothing is inferred from live
 * readings: a threshold appears as achieved only when an event names it.
 * @param {any[]} events newest first
 * @param {number} now
 */
export function milestones(events, now) {
  /** @param {string} type */
  const of = (type) => events.filter((e) => e.type === type);
  /** @param {any[]} list @param {string} key */
  const byThreshold = (list, key) => {
    /** @type {Map<string, any>} */
    const m = new Map();
    for (const e of list) {
      const k = String(e.payload?.[key] ?? '');
      if (!k) continue;
      const prev = m.get(k);
      if (!prev || (ms(e.occurredAt) ?? 0) < (ms(prev.occurredAt) ?? 0)) m.set(k, e); // first time reached
    }
    return [...m.values()].sort((a, b) => (num(a.payload[key]) ?? 0) - (num(b.payload[key]) ?? 0));
  };
  const today = gameDay(now);
  const daily = of('measurement.daily_distance_milestone');
  const dailyToday = byThreshold(daily.filter((e) => e.payload?.utcDate === today), 'thresholdDistanceMm');
  const streaks = of('measurement.distance_streak')
    .slice()
    .sort((a, b) => (num(b.payload?.days) ?? 0) - (num(a.payload?.days) ?? 0));
  const records = of('measurement.speed_record');
  return {
    today,
    distance: byThreshold(of('measurement.distance_milestone'), 'thresholdDistanceMm'),
    dailyAll: byThreshold(daily, 'thresholdDistanceMm'),
    dailyToday,
    dailyDays: [...new Set(daily.map((e) => e.payload?.utcDate).filter(Boolean))].sort().reverse(),
    speed: byThreshold(of('measurement.speed_milestone'), 'thresholdSpeedMmPerSecond'),
    records,
    currentRecord: records[0] ?? null,
    streaks,
    longestStreak: streaks[0] ?? null,
  };
}

/** Latest milestone-type event (distance, daily, speed or streak). @param {any[]} events */
export function latestMilestone(events) {
  return events.find((e) => /milestone|streak/.test(String(e.type))) ?? null;
}

/**
 * Latest "important" event: records, lifetime milestones and streaks rank
 * above daily and speed milestones; within a rank the newest wins.
 * @param {any[]} events newest first
 */
export function latestImportant(events) {
  const major = ['measurement.speed_record', 'measurement.distance_milestone', 'measurement.distance_streak'];
  return events.find((e) => major.includes(e.type)) ?? events[0] ?? null;
}

/**
 * Current round window. The round number is only given when it can be
 * anchored to a round the API itself named (settlements' mining.nextRound);
 * otherwise only the 600 s window from the genesis timestamp is known.
 * @param {{ genesisTimestamp?: unknown, anchorRound?: unknown, anchorStartsAt?: unknown }} src
 * @param {number} now
 * @returns {null | { round: string | null, startsAt: number, endsAt: number, remaining: number, fraction: number }}
 */
export function roundWindow(src, now) {
  const len = ROUND_SECONDS * 1000;
  const anchorRound = big(src.anchorRound);
  const anchorStart = ms(src.anchorStartsAt);
  let start = null;
  let round = null;
  if (anchorRound !== null && anchorStart !== null) {
    const k = Math.floor((now - anchorStart) / len);
    start = anchorStart + k * len;
    round = (anchorRound + BigInt(k)).toString();
  } else {
    const g = num(src.genesisTimestamp);
    if (g === null) return null;
    const k = Math.floor((now - g * 1000) / len);
    start = g * 1000 + k * len;
  }
  const end = start + len;
  return { round, startsAt: start, endsAt: end, remaining: (end - now) / 1000, fraction: (now - start) / len };
}

/**
 * Today's distance from 7-day stats: the measurement day that contains `now`.
 * Returns null (not zero) when the day is absent or has no distance.
 * @param {any} stats @param {number} now
 */
export function todayFromStats(stats, now) {
  const key = gameDay(now);
  const day = stats?.activity?.days?.find?.((/** @type {any} */ d) => d.date === key);
  if (!day) return { key, day: null, distanceMm: null, coverageBps: null };
  return { key, day, distanceMm: day.distanceMm ?? null, coverageBps: day.coverage?.coverageBps ?? null };
}

/**
 * Settlements newest first by block time.
 * @param {any[]} list
 */
export function sortSettlements(list) {
  return list.slice().sort((a, b) => (ms(b.blockTimestamp) ?? 0) - (ms(a.blockTimestamp) ?? 0));
}

/**
 * Transport success does not establish snapshot freshness. Ranged settlement
 * responses are shared for 60 seconds; allow one more polling interval.
 * @param {{source:string|null, generatedAt:string|null, window:any}|null} snapshot
 * @param {number} now
 */
export function settlementFreshness(snapshot, now) {
  const generated = ms(snapshot?.generatedAt);
  const end = ms(snapshot?.window?.endAt);
  const reasons = [];
  if (snapshot?.source === 'durable-cache') reasons.push('durable-cache fallback');
  if (snapshot?.source === 'unavailable') reasons.push('source unavailable');
  if (end !== null && now >= end) reasons.push('snapshot window has expired');
  if (generated !== null && now - generated > 120_000) reasons.push('snapshot is over two minutes old');
  const freshness = reasons.length ? 'stale' : generated === null || end === null ? 'unavailable' : 'fresh';
  return { freshness: /** @type {'fresh'|'stale'|'unavailable'} */ (freshness), reasons };
}

/**
 * "What just happened?" sentences, each from a field the API returned.
 * Sentences whose source is missing are left out rather than guessed.
 * @param {{ status:any, statusFresh:'fresh'|'stale'|'unavailable', events:any[], stats:any, settlements:any, now:number }} s
 * @returns {string[]}
 */
export function summary(s) {
  const out = [];
  const m = s.status?.measurement;
  if (s.statusFresh === 'unavailable') {
    out.push('Live wheel readings are unavailable right now.');
  } else if (m) {
    const when = ago(ms(m.observedAt), s.now);
    const speed = num(m.speedMmPerSecond);
    const moving = m.coreStatus === 'ACTIVE' || (speed !== null && speed > 0);
    const lead = s.statusFresh === 'stale' ? `The last reading, ${when}, is stale: ` : `As of ${when}, `;
    out.push(
      moving
        ? `${lead}the hamster is running at ${speedKmh(speed) ?? 'an unreported speed'}.`
        : `${lead}the wheel is ${m.coreStatus === 'COUNTER_FAULT' ? 'reporting a counter fault' : 'idle'}.`,
    );
  }
  const t = todayFromStats(s.stats, s.now);
  if (t.distanceMm !== null) {
    out.push(`The current measurement day (from ${t.key}, 12:00 UTC) has logged ${distance(t.distanceMm)} so far.`);
  }
  const e = s.events[0];
  if (e) out.push(`Latest event: ${describeEvent(e).title}, ${ago(ms(e.occurredAt), s.now)}.`);
  const sub = s.status?.settlementQueue?.latestSubmission;
  if (sub && sub.lifecycle && !sub.confirmedAt) {
    out.push(`Rounds through ${sub.settledThroughRound} are ${sub.lifecycle}, not yet confirmed on-chain.`);
  }
  const latest = sortSettlements(s.settlements?.recentSettlements ?? [])[0];
  if (latest) {
    out.push(
      `Last confirmed settlement with work: rounds ${latest.previousSettledThroughRound} to ${latest.settledThroughRound}, ${int(latest.workAdded)} work units, ${ago(ms(latest.blockTimestamp), s.now)}.`,
    );
  }
  return out;
}
