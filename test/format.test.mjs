// Run with: npm test  (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  num, big, int, distance, speedKmh, speedMms, rpm, pctBps, sqk, blockFraction, ago, utc, gameDay, clock, shortHash, humanize, esc,
} from '../src/js/format.js';

test('missing values never become zero', () => {
  for (const f of [num, int, distance, speedKmh, speedMms, rpm, pctBps, sqk, blockFraction]) {
    assert.equal(f(null), null, f.name);
    assert.equal(f(undefined), null, f.name);
  }
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(big('12.5'), null);
});

test('real zero stays zero', () => {
  assert.equal(rpm(0), '0.0 RPM');
  assert.equal(speedMms(0), '0 mm/s');
  assert.equal(int('0'), '0');
});

test('distance units', () => {
  assert.equal(distance(3351326), '3.35 km');
  assert.equal(distance('3000000'), '3.00 km');
  assert.equal(distance(12345), '12.3 m');
  assert.equal(distance(250), '25.0 cm');
});

test('speed and rpm', () => {
  assert.equal(speedKmh(1161), '4.18 km/h');
  assert.equal(speedKmh('833'), '3.00 km/h');
  assert.equal(speedMms('1161'), '1,161 mm/s');
  assert.equal(rpm(79775), '79.8 RPM');
});

test('big integers keep precision', () => {
  assert.equal(int('366425653103'), '366,425,653,103');
  assert.equal(sqk('66142272600198236206048'), '66,142.27 SQK');
  assert.equal(sqk('0'), '0.00 SQK');
});

test('basis points and block progress', () => {
  assert.equal(pctBps(10000), '100%');
  assert.equal(pctBps(2221), '22.2%');
  assert.equal(blockFraction('425653103'), 0.425653103);
  assert.equal(blockFraction('-1'), null);
});

test('measurement day runs 12:00 to 12:00 UTC', () => {
  assert.equal(gameDay(Date.parse('2026-11-05T08:22:00Z')), '2026-11-04');
  assert.equal(gameDay(Date.parse('2026-11-05T12:00:00Z')), '2026-11-05');
  assert.equal(gameDay(Date.parse('2026-11-05T11:59:59Z')), '2026-11-04');
});

test('time formatting', () => {
  const now = Date.parse('2026-11-05T08:22:00Z');
  assert.equal(ago(now - 2000, now), 'just now');
  assert.equal(ago(now - 30_000, now), '30s ago');
  assert.equal(ago(now - 5 * 60_000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(ago(null, now), null);
  assert.equal(utc('2026-11-05T08:22:00.772Z'), '5 Nov, 08:22:00 UTC');
  assert.equal(utc('not a date'), null);
  assert.equal(clock(125.4), '2:05');
  assert.equal(clock(-3), '0:00');
});

test('text helpers', () => {
  assert.equal(shortHash('0x1d3ac659d18c4df050506c6ff517ba161c4b8a3dd85b530812857bd7ebf5d78a'), '0x1d3ac6…f5d78a');
  assert.equal(humanize('COUNTER_FAULT'), 'Counter fault');
  assert.equal(humanize('completion_boundaries_unavailable'), 'Completion boundaries unavailable');
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});
