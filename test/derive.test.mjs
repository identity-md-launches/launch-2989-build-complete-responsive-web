// Run with: npm test  (node --test)
// Fixtures mirror field names and values observed from the live API on 2026-11-05.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshness, describeEvent, mergeEvents, milestones, latestImportant, latestMilestone, roundWindow, todayFromStats, summary, sortSettlements,
} from '../src/js/derive.js';
import { getJson } from '../src/js/api.js';

const now = Date.parse('2026-11-05T08:23:00Z');
const measurement = {
  freshness: 'online',
  observedAt: '2026-11-05T08:22:00.772Z',
  staleAfterSeconds: 120,
  cumulativeWorkUnits: '3817',
  coreStatus: 'IDLE',
  rpmMilli: 0,
  speedMmPerSecond: 0,
  distanceMm: 3351326,
  provenance: 'hardware',
};

/** @param {string} id @param {string} type @param {string} at @param {object} payload */
const ev = (id, type, at, payload) => ({ id, type, occurredAt: at, payload });
const events = mergeEvents([], [
  ev('a', 'measurement.speed_milestone', '2026-11-05T02:42:57.401Z', { thresholdSpeedMmPerSecond: '556', observedSpeedMmPerSecond: '687' }),
  ev('b', 'measurement.speed_milestone', '2026-11-05T04:15:59.166Z', { thresholdSpeedMmPerSecond: '833', observedSpeedMmPerSecond: '854' }),
  ev('c', 'measurement.speed_record', '2026-11-05T04:15:59.166Z', { previousRecordMmPerSecond: '687', recordMmPerSecond: '854', observedSpeedMmPerSecond: '854' }),
  ev('d', 'measurement.distance_milestone', '2026-11-05T04:38:29.091Z', { thresholdDistanceMm: '1000000', observedLifetimeDistanceMm: '1000042' }),
  ev('e', 'measurement.daily_distance_milestone', '2026-11-05T04:38:29.091Z', { thresholdDistanceMm: '1000000', observedDayDistanceMm: '1000042', utcDate: '2026-11-04' }),
  ev('f', 'measurement.speed_record', '2026-11-05T05:12:05.884Z', { previousRecordMmPerSecond: '1081', recordMmPerSecond: '1161', observedSpeedMmPerSecond: '1161' }),
  ev('g', 'measurement.distance_milestone', '2026-11-05T05:54:49.178Z', { thresholdDistanceMm: '3000000', observedLifetimeDistanceMm: '3000126' }),
  ev('h', 'measurement.daily_distance_milestone', '2026-11-05T05:54:49.178Z', { thresholdDistanceMm: '3000000', observedDayDistanceMm: '3000126', utcDate: '2026-11-04' }),
]);

test('freshness: fresh, stale, unavailable', () => {
  assert.equal(freshness(measurement, now, now), 'fresh');
  assert.equal(freshness({ ...measurement, freshness: 'stale' }, now, now), 'stale');
  assert.equal(freshness(measurement, now, now + 10 * 60_000), 'stale');
  assert.equal(freshness(null, now, now), 'unavailable');
  assert.equal(freshness(measurement, null, now), 'unavailable');
});

test('events merge newest first and deduplicate by id', () => {
  const again = mergeEvents(events, [events[0], events[3]]);
  assert.equal(again.length, events.length);
  assert.equal(again[0].occurredAt, '2026-11-05T05:54:49.178Z');
  assert.ok(again.every((e, i) => i === 0 || Date.parse(again[i - 1].occurredAt) >= Date.parse(e.occurredAt)));
});

test('event descriptions use payload values only', () => {
  const rec = describeEvent(events.find((e) => e.id === 'f'));
  assert.equal(rec.title, 'New speed record: 4.18 km/h');
  assert.match(rec.description, /previous record of 3\.89 km\/h by 80 mm\/s/);
  const streak = describeEvent({ type: 'measurement.distance_streak', payload: { days: '3', minimumDailyDistanceMm: '1000000', endingUtcDate: '2026-11-04' } });
  assert.equal(streak.title, 'Distance streak: 3 days');
  const missing = describeEvent({ type: 'measurement.distance_milestone', payload: {} });
  assert.match(missing.title, /not reported/);
  const unknown = describeEvent({ type: 'measurement.rpm_record', payload: { x: '1' } });
  assert.equal(unknown.tone, 'other');
});

test('milestones come only from events', () => {
  const m = milestones(events, now);
  assert.deepEqual(m.distance.map((e) => e.payload.thresholdDistanceMm), ['1000000', '3000000']);
  assert.deepEqual(m.speed.map((e) => e.payload.thresholdSpeedMmPerSecond), ['556', '833']);
  assert.equal(m.today, '2026-11-04');
  assert.equal(m.dailyToday.length, 2);
  assert.equal(m.currentRecord.payload.recordMmPerSecond, '1161');
  assert.equal(m.longestStreak, null);
  const empty = milestones([], now);
  assert.equal(empty.distance.length + empty.speed.length + empty.dailyAll.length, 0);
});

test('latest important and latest milestone', () => {
  assert.equal(latestImportant(events).id, 'g');
  assert.equal(latestMilestone(events).id, 'h');
  assert.equal(latestImportant([]), null);
});

test('round window anchors to an API-named round, else no id', () => {
  const anchored = roundWindow({ anchorRound: '219', anchorStartsAt: '2026-11-05T08:10:00.000Z', genesisTimestamp: '1793735400' }, now);
  assert.equal(anchored.round, '220');
  assert.equal(new Date(anchored.startsAt).toISOString(), '2026-11-05T08:20:00.000Z');
  assert.equal(Math.round(anchored.remaining), 420);
  const unanchored = roundWindow({ genesisTimestamp: '1793735400' }, now);
  assert.equal(unanchored.round, null);
  assert.equal(new Date(unanchored.startsAt).toISOString(), '2026-11-05T08:20:00.000Z');
  assert.equal(roundWindow({}, now), null);
});

test("today's distance is null when the day is missing", () => {
  const stats = { activity: { days: [{ date: '2026-11-04', distanceMm: '3351326', coverage: { coverageBps: 10000 } }] } };
  assert.equal(todayFromStats(stats, now).distanceMm, '3351326');
  assert.equal(todayFromStats(stats, Date.parse('2026-11-05T13:00:00Z')).distanceMm, null);
  assert.equal(todayFromStats(null, now).distanceMm, null);
});

test('summary only states what the data supports', () => {
  const lines = summary({ status: { measurement }, statusFresh: 'fresh', events, stats: null, settlements: null, now });
  assert.ok(lines[0].includes('idle'));
  assert.ok(lines.some((l) => l.startsWith('Latest event: Daily distance passed 3.00 km')));
  assert.ok(!lines.some((l) => l.includes('measurement day')));
  const none = summary({ status: null, statusFresh: 'unavailable', events: [], stats: null, settlements: null, now });
  assert.deepEqual(none, ['Live wheel readings are unavailable right now.']);
});

test('settlements sort newest first', () => {
  const s = sortSettlements([{ blockTimestamp: '2026-11-05T06:40:36.000Z' }, { blockTimestamp: '2026-11-05T06:50:36.000Z' }]);
  assert.equal(s[0].blockTimestamp, '2026-11-05T06:50:36.000Z');
});

/** @param {number} status @param {any} body @param {Record<string,string>} [headers] */
const fakeFetch = (status, body, headers = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (/** @type {string} */ k) => headers[k] ?? null },
  json: async () => {
    if (body instanceof Error) throw body;
    return body;
  },
});

test('api client: unavailable, errors, schema checks', async () => {
  const u = await getJson('/measurement/stats?range=7d', 'stats', { fetchImpl: /** @type {any} */ (fakeFetch(200, { status: 'unavailable', reason: 'projection_not_initialized' })) });
  assert.equal(u.kind, 'unavailable');
  assert.equal(u.reason, 'projection not initialized');
  const rl = await getJson('/events', 'events', { fetchImpl: /** @type {any} */ (fakeFetch(429, { error: 'rate_limited' }, { 'Retry-After': '3' })) });
  assert.equal(rl.kind, 'error');
  assert.equal(rl.retryAfterMs, 3000);
  const bad = await getJson('/status', 'status', { fetchImpl: /** @type {any} */ (fakeFetch(200, { schemaVersion: 99, measurement: null })) });
  assert.equal(bad.kind, 'error');
  const notJson = await getJson('/status', 'status', { fetchImpl: /** @type {any} */ (fakeFetch(502, new Error('x'))) });
  assert.equal(notJson.kind, 'error');
  const ok = await getJson('/status', 'status', { fetchImpl: /** @type {any} */ (fakeFetch(200, { schemaVersion: 1, measurement: null })) });
  assert.equal(ok.kind, 'ok');
});
