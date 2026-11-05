import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getJson } from '../src/js/api.js';
import { settlementFreshness } from '../src/js/derive.js';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/api/${name}.json`, import.meta.url)));
let instance = 0;
const store = () => import(`../src/js/store.js?test=${instance++}`);
const response = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), { status, headers });

test('settlement source, timestamp and window survive refresh and serialization to the browser cache', async t => {
  const original = globalThis.fetch;
  const oldStorage = globalThis.localStorage;
  const saved = new Map();
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  t.after(() => { globalThis.fetch = original; globalThis.localStorage = oldStorage; });
  const data = await fixture('settlements');
  globalThis.fetch = async () => response(data, { 'X-Squeek-Settlement-Source': 'durable-cache' });
  const result = await getJson('/settlements?range=24h', 'settlements');
  assert.equal(result.settlementSource, 'durable-cache');
  const s = await store();
  await s.refresh('settlements');
  assert.equal(s.state.res.settlements.snapshot.source, 'durable-cache');
  assert.equal(s.state.res.settlements.snapshot.generatedAt, data.generatedAt);
  assert.deepEqual(s.state.res.settlements.snapshot.window, data.window);
  const cache = JSON.parse(saved.get('squeek-radar.cache.v1.settlements'));
  assert.deepEqual(cache.snapshot, s.state.res.settlements.snapshot);
  globalThis.fetch = async () => response({ status: 'unavailable', reason: 'indexer_unavailable' });
  await s.refresh('settlements');
  assert.equal(s.state.res.settlements.state, 'unavailable');
  assert.equal(s.state.res.settlements.data.recentSettlements.length, data.recentSettlements.length);
  assert.equal(s.state.res.settlements.snapshot.source, 'durable-cache');
});

test('settlement freshness depends on the source, generation time and UTC window', () => {
  const now = Date.parse('2026-11-05T09:30:00Z');
  const snapshot = { source: 'live', generatedAt: '2026-11-05T09:29:30Z', window: { startAt: '2026-11-04T10:00:00Z', endAt: '2026-11-05T10:00:00Z' } };
  assert.equal(settlementFreshness(snapshot, now).freshness, 'fresh');
  assert.equal(settlementFreshness({ ...snapshot, source: 'durable-cache' }, now).freshness, 'stale');
  assert.ok(settlementFreshness({ ...snapshot, window: { endAt: '2026-11-05T09:00:00Z' } }, now).reasons.includes('snapshot window has expired'));
  assert.equal(settlementFreshness(snapshot, now + 121_000).freshness, 'stale');
  assert.equal(settlementFreshness(null, now).freshness, 'unavailable');
  assert.equal(settlementFreshness({ ...snapshot, window: { endAt: '2026-11-05T09:30:00Z' } }, now).freshness, 'stale');
});

test('events retain genuine history when HTTP 200 reports unavailable', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = await fixture('events');
  const s = await store();
  globalThis.fetch = async () => response(data);
  await s.refresh('events');
  const lastOk = s.state.res.events.lastOkAt;
  globalThis.fetch = async () => response({ schemaVersion: 4, status: 'unavailable', reason: 'indexer_unavailable', events: [], nextCursor: null });
  await s.refresh('events');
  assert.equal(s.state.res.events.state, 'unavailable');
  assert.equal(s.state.res.events.lastOkAt, lastOk);
  assert.equal(s.state.res.events.data, null);
  assert.equal(s.state.events.length, data.events.length);
});

test('returning after 50 new events catches up all pages and creates each alert once', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = await fixture('events');
  const s = await store();
  globalThis.fetch = async () => response(data);
  await s.refresh('events');
  const template = data.events.find(e => e.type === 'measurement.speed_record');
  // Controlled test-only arrivals; these never enter the production application.
  const added = Array.from({ length: 50 }, (_, i) => ({ ...template, id: `test:new-record:${i}`, occurredAt: new Date(Date.parse(data.generatedAt) + (i + 1) * 1000).toISOString(), payload: { recordMmPerSecond: 1220 + i * 56, previousRecordMmPerSecond: 1164 + i * 56 } })).reverse();
  const requests = [];
  let alerts = [];
  s.onAlerts(a => alerts.push(...a));
  globalThis.fetch = async url => {
    requests.push(url);
    return response(new URL(url).searchParams.has('cursor')
      ? { ...data, events: [...added.slice(40), ...data.events], nextCursor: null }
      : { ...data, events: added.slice(0, 40), nextCursor: 'test:catchup' });
  };
  await s.refresh('events');
  assert.equal(s.state.events.length, data.events.length + 50);
  assert.equal(s.unreadCount(), 50);
  assert.equal(alerts.length, 50);
  assert.equal(new Set(alerts.map(a => a.id)).size, 50);
  assert.equal(s.state.eventCatchup, null);
  assert.equal(s.state.olderCursor, null);
  assert.ok(requests.some(url => new URL(url).searchParams.get('cursor') === 'test:catchup'));
  await s.refresh('events');
  assert.equal(s.unreadCount(), 50);
  assert.equal(alerts.length, 50);
  s.markRead(added[0].id); assert.equal(s.unreadCount(), 49);
  s.markAllRead(); assert.equal(s.unreadCount(), 0);
});

test('failed catch-up resumes its gap cursor and leaves older-history pagination separate', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = await fixture('events');
  const s = await store();
  globalThis.fetch = async () => response({ ...data, nextCursor: 'test:older' });
  await s.refresh('events');
  const e = { ...data.events[0], id: 'test:after-pause' };
  let fail = true;
  const requests = [];
  globalThis.fetch = async url => {
    const cursor = new URL(url).searchParams.get('cursor'); requests.push(cursor);
    if (!cursor) return response({ ...data, events: [e], nextCursor: 'test:gap' });
    if (fail) return response({ status: 'unavailable', reason: 'indexer_unavailable' });
    return response({ ...data, nextCursor: 'test:still-older' });
  };
  await s.refresh('events');
  assert.equal(s.state.res.events.state, 'unavailable');
  assert.equal(s.state.eventCatchup.cursor, 'test:gap');
  assert.equal(s.state.olderCursor, 'test:older');
  fail = false;
  await s.refresh('events');
  assert.equal(s.state.eventCatchup, null);
  assert.equal(s.state.olderCursor, 'test:older');
  assert.equal(requests.filter(c => c === 'test:gap').length, 2);
  assert.equal(s.unreadCount(), 1);
});

test('runs advance through real oldest-first pages and preserve the empty-page tail cursor', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const first = await fixture('runs'), second = await fixture('runs-next');
  const s = await store();
  const calls = [];
  let more = false;
  const arrival = { ...second.items.at(-1), segmentId: 'test:new-segment', startAt: '2026-11-05T09:14:00Z' };
  globalThis.fetch = async url => {
    const cursor = new URL(url).searchParams.get('cursor'); calls.push(cursor);
    if (!cursor) return response(first);
    if (cursor === first.nextCursor) return response(second);
    if (more && cursor === second.nextCursor) return response({ ...second, items: [arrival], nextCursor: 'test:tail' });
    return response({ ...second, items: [], nextCursor: cursor });
  };
  await s.refresh('runs');
  assert.equal(s.state.res.runs.data.items.length, first.items.length + second.items.length);
  assert.equal(s.state.res.runs.data.items[0].segmentId, second.items.at(-1).segmentId);
  assert.equal(s.state.runsCursor, second.nextCursor);
  assert.equal(s.state.runsCatchingUp, false);
  more = true;
  await s.refresh('runs');
  assert.equal(s.state.res.runs.data.items[0].segmentId, arrival.segmentId);
  assert.equal(s.state.runsCursor, 'test:tail');
  assert.equal(calls.filter(c => c === null).length, 1);
  await s.refresh('runs');
  assert.equal(s.state.res.runs.data.items.length, 41);
  assert.equal(s.state.runsCursor, 'test:tail');
});

test('a failed runs page resumes; invalid cursors restart at the documented first page', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = await fixture('runs');
  const s = await store();
  let invalid = false;
  globalThis.fetch = async url => new URL(url).searchParams.has('cursor')
    ? invalid ? response({ error: 'invalid_cursor' }, {}, 400) : response({ error: 'indexer_busy' }, {}, 503)
    : response(data);
  await s.refresh('runs');
  assert.equal(s.state.runsCursor, data.nextCursor);
  assert.equal(s.state.res.runs.state, 'error');
  assert.equal(s.state.res.runs.data.items.length, data.items.length);
  invalid = true; await s.refresh('runs');
  assert.equal(s.state.runsCursor, null);
});
