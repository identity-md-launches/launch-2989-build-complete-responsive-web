import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { state } from '../src/js/store.js';
import { VIEWS } from '../src/js/views.js';

const view = id => VIEWS.find(v => v.id === id).regions({ filter: 'all' });
const html = id => view(id).map(r => r.html).join('');
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/api/${name}.json`, import.meta.url)));

test('every event-derived view exposes unavailable retained history and its last successful check', async () => {
  state.events = (await fixture('events')).events;
  state.olderCursor = null;
  state.alerts.items = [{ id: 'test:alert', title: 'Test history', type: 'measurement.speed_record', occurredAt: state.events[0].occurredAt, read: true }];
  Object.assign(state.res.events, { state: 'unavailable', data: null, message: 'indexer unavailable', lastOkAt: Date.parse('2026-11-05T09:13:00Z') });
  for (const id of ['dashboard', 'events', 'milestones', 'alerts']) {
    const content = html(id);
    assert.match(content, /Events source is unavailable/);
    assert.match(content, /indexer unavailable/);
    assert.match(content, /last-known history/);
    assert.match(content, /last successful check/);
    assert.match(content, /2026-11-05T09:13:00/);
  }
  assert.doesNotMatch(html('milestones'), /Based on the full event history/);
  // An unfinished gap must not claim full coverage, even with no older history.
  state.res.events.state = 'ok';
  state.eventCatchup = { cursor: 'test:pending', stopIds: new Set() };
  assert.doesNotMatch(html('events'), /You have reached the start/);
  assert.doesNotMatch(html('milestones'), /Based on the full event history/);
  assert.match(html('alerts'), /History coverage is incomplete/);
  state.eventCatchup = null;
});

test('round loading resolves for unavailable, mixed failure and missing-schedule states', () => {
  for (const key of ['status', 'blocks', 'settlements']) Object.assign(state.res[key], { state: 'unavailable', data: null, message: 'indexer unavailable' });
  const current = () => view('rounds').find(r => r.key === 'round').html;
  assert.match(current(), /Round data is unavailable/);
  assert.match(current(), /indexer unavailable/);
  assert.match(current(), /retries automatically/);
  assert.doesNotMatch(current(), /Loading round data/);
  state.res.blocks.state = 'error'; assert.match(current(), /Round data is unavailable/);
  state.res.settlements.state = 'loading'; assert.match(current(), /Loading round data/);
  state.res.settlements.state = 'ok'; assert.match(current(), /Round data is unavailable/);
});

test('round and dashboard settlement panels expose durable-cache timestamps and actual window', async () => {
  state.res.settlements.data = await fixture('settlements');
  Object.assign(state.res.settlements, { state: 'ok', lastOkAt: Date.now(), snapshot: { source: 'durable-cache', generatedAt: '2026-11-05T07:13:18Z', window: { startAt: '2026-11-04T08:00:00Z', endAt: '2026-11-05T08:00:00Z' } } });
  for (const id of ['rounds', 'dashboard']) {
    assert.match(html(id), /Stale settlement snapshot/);
    assert.match(html(id), /durable-cache/);
    assert.match(html(id), /Snapshot as of/);
    assert.match(html(id), /Window:/);
    assert.match(html(id), /2026-11-05T07:13:18Z/);
  }
  state.res.settlements.state = 'unavailable';
  state.res.settlements.message = 'indexer unavailable';
  assert.match(html('rounds'), /last-known confirmed history/);
  assert.match(html('rounds'), /Recent settlements table/);
});
