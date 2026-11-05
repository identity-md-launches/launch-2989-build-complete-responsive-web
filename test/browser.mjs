// Production-export regressions. Replays captured real API data; altered fields
// simulate arrivals and failures only in this test. Nothing here is shipped.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = process.env.RADAR_PLAYWRIGHT
  ? await import(pathToFileURL(resolve(process.env.RADAR_PLAYWRIGHT)).href)
  : await import('playwright');
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/api/${name}.json`, import.meta.url)));
const payloads = Object.fromEntries(await Promise.all(['status', 'events', 'runs', 'blocks', 'stats', 'settlements'].map(async k => [k, await fixture(k)])));
const runsNext = await fixture('runs-next');
const originalEvents = structuredClone(payloads.events);
const out = 'test/scratch/browser-regressions';
await mkdir(out, { recursive: true });
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/preview\//, '') || 'index.html';
  const file = resolve(root, name);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true, ...(process.env.RADAR_BROWSER_EXECUTABLE ? { executablePath: process.env.RADAR_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
const results = [];
const errors = [], resourceErrors = [];
const requests = [];
let settlementSource = 'live', eventMode = 'normal', catchupFails = false, runArrival = false, allUnavailable = false;
let added = [];
const arrival = { ...runsNext.items.at(-1), segmentId: 'test:new-segment', startAt: '2026-11-05T09:14:00Z' };

async function setup(context) {
  await context.route('https://api.squeekchain.com/v1/**', async route => {
    const u = new URL(route.request().url());
    const kind = u.pathname.split('/').at(-1), cursor = u.searchParams.get('cursor');
    requests.push(u.pathname + u.search);
    let json = payloads[kind];
    if (allUnavailable && ['status', 'blocks', 'settlements'].includes(kind)) json = { status: 'unavailable', reason: 'indexer_unavailable' };
    if (kind === 'runs' && cursor) {
      json = cursor === payloads.runs.nextCursor ? runsNext
        : runArrival && cursor === runsNext.nextCursor ? { ...runsNext, items: [arrival], nextCursor: 'test:runs-tail' }
          : { ...runsNext, items: [], nextCursor: cursor };
    }
    if (kind === 'events' && eventMode === 'catchup') json = !cursor
      ? { ...originalEvents, events: added.slice(0, 40), nextCursor: 'test:gap' }
      : catchupFails ? { schemaVersion: 4, status: 'unavailable', reason: 'indexer_unavailable', events: [], nextCursor: null }
        : { ...originalEvents, events: [...added.slice(40), ...originalEvents.events], nextCursor: null };
    await route.fulfill({ json, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Squeek-Settlement-Source', ...(kind === 'settlements' ? { 'X-Squeek-Settlement-Source': settlementSource } : {}) } });
  });
  await context.addInitScript(() => {
    window.__notificationRequests = 0;
    if (typeof Notification !== 'undefined') {
      const request = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => { window.__notificationRequests++; return request(...args); };
    }
  });
}
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await setup(context);
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('response', res => { if (res.url().startsWith(base) && res.status() >= 400) resourceErrors.push(res.url()); });
await page.clock.install({ time: new Date(payloads.status.generatedAt) });
const refresh = key => page.evaluate(async key => (await import('./js/store.js')).refresh(key).then(r => r.kind), key);
const go = async id => { await page.locator(`#nav a[href="${id ? '#/' + id : '#/'}"]`).click(); await page.waitForTimeout(600); };
const mainText = () => page.locator('main').innerText();
const check = async (name, action) => { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };

try {
  await page.goto(base);
  await page.waitForFunction(async () => {
    const { state } = await import('./js/store.js');
    return Object.values(state.res).every(r => r.state !== 'loading') && !state.runsCatchingUp;
  });
  await check('390px first screen exposes the product and main action', async () => {
    const button = page.getByRole('link', { name: 'Open live event feed' });
    const box = await button.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 844);
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
    assert.equal(await page.locator('title').count(), 1);
    for (const selector of ['link[rel="icon"]', 'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:image"]']) assert.equal(await page.locator(selector).count(), 1);
    await page.screenshot({ path: `${out}/dashboard-390.png`, fullPage: false });
    await button.click(); assert.equal(await page.locator('h1').textContent(), 'Live event feed');
  });
  await check('event filters show genuine matching rows and allow returning to All', async () => {
    await page.getByRole('button', { name: /^Speed records/ }).click();
    assert.equal(await page.getByRole('button', { name: /^Speed records/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.event').count(), originalEvents.events.filter(e => e.type === 'measurement.speed_record').length);
    await page.getByRole('button', { name: /^All / }).click();
    assert.equal(await page.locator('.event').count(), originalEvents.events.length);
  });
  await check('all six routes reflow at 320, 390, 768 and 1440 without document scrolling', async () => {
    const dimensions = [];
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      for (const id of ['', 'live', 'events', 'milestones', 'rounds', 'alerts']) {
        await go(id);
        const size = await page.evaluate(() => {
          window.scrollTo(300, 0);
          return { viewport: innerWidth, document: document.documentElement.scrollWidth, scrollX };
        });
        dimensions.push({ width, route: id || 'dashboard', ...size });
        assert.equal(size.document, width, `${id} document width at ${width}`);
        assert.equal(size.scrollX, 0, `${id} document scrollX at ${width}`);
      }
    }
    await writeFile(`${out}/dimensions.json`, JSON.stringify(dimensions, null, 2));
    await go('rounds');
    const table = page.getByRole('region', { name: 'Recent settlements table' });
    await page.setViewportSize({ width: 390, height: 844 });
    const local = await table.evaluate(el => { el.scrollLeft = 200; return { width: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft, position: getComputedStyle(el).position }; });
    assert.ok(local.scrollWidth > local.width && local.scrollLeft > 0);
    assert.equal(local.position, 'relative');
    await page.screenshot({ path: `${out}/rounds-390.png`, fullPage: true });
  });
  await check('keyboard skip link preserves every section and focuses existing main', async () => {
    for (const id of ['live', 'events', 'milestones', 'rounds', 'alerts']) {
      await go(id); const before = await page.locator('h1').textContent();
      await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
      assert.equal(new URL(page.url()).hash, '#/' + id);
      assert.equal(await page.locator('h1').textContent(), before);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
    }
    await go('live'); await page.locator('.skip-link').focus();
    await page.screenshot({ path: `${out}/skip-focus-390.png` });
  });
  await check('old durable-cache settlements stay visible with source, as-of time and UTC window', async () => {
    const shift = v => Array.isArray(v) ? v.map(shift) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) - 2 * 3600_000).toISOString() : v;
    payloads.settlements = shift(payloads.settlements);
    payloads.settlements.mining = { status: 'unavailable', reason: 'not_configured' };
    settlementSource = 'durable-cache';
    await refresh('settlements');
    for (const id of ['rounds', '']) {
      await go(id);
      const text = await mainText();
      for (const term of ['Stale settlement snapshot', 'durable-cache', 'snapshot window has expired', 'Snapshot as of', 'Window:']) assert.ok(text.includes(term), `${id}: ${term}`);
    }
    await go('rounds');
    assert.ok(await page.getByRole('region', { name: 'Recent settlements table' }).isVisible());
    await page.screenshot({ path: `${out}/stale-settlements-390.png`, fullPage: true });
    await page.reload();
    await page.waitForFunction(async () => (await import('./js/store.js')).state.res.settlements.fromCache);
    assert.ok((await mainText()).includes('durable-cache'));
    assert.ok((await mainText()).includes('saved in this browser'));
  });
  await check('HTTP-success unavailable events are explicit in every derived view after polling', async () => {
    await go('events');
    await page.waitForFunction(async () => (await import('./js/store.js')).state.events.length === 11);
    payloads.events = { schemaVersion: 4, status: 'unavailable', reason: 'indexer_unavailable', events: [], nextCursor: null };
    await page.clock.fastForward(10_100);
    await page.waitForFunction(async () => (await import('./js/store.js')).state.res.events.state === 'unavailable');
    for (const id of ['events', 'milestones', 'alerts', '']) {
      await go(id); const text = await mainText();
      for (const term of ['Events source is unavailable', 'indexer unavailable', 'last-known history', 'last successful check']) assert.ok(text.includes(term), `${id}: ${term}`);
    }
    await go('milestones'); assert.ok(!(await mainText()).includes('Based on the full event history'));
    await page.screenshot({ path: `${out}/unavailable-milestones-390.png`, fullPage: true });
    payloads.events = originalEvents; await refresh('events');
  });
  await check('resume catches 50 arrivals across pages; failed catch-up retries without false complete coverage', async () => {
    const template = originalEvents.events.find(e => e.type === 'measurement.speed_record');
    added = Array.from({ length: 50 }, (_, i) => ({ ...template, id: `test:record:${i}`, occurredAt: new Date(Date.parse(originalEvents.generatedAt) + (i + 1) * 1000).toISOString(), payload: { recordMmPerSecond: 1220 + 56 * i, previousRecordMmPerSecond: 1164 + 56 * i } })).reverse();
    eventMode = 'catchup'; catchupFails = true;
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    await page.clock.fastForward(16_000);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(async () => { const { state } = await import('./js/store.js'); return state.eventCatchup && state.res.events.state === 'unavailable'; });
    await go('events'); assert.ok(!(await mainText()).includes('You have reached the start'));
    await go('milestones'); assert.ok(!(await mainText()).includes('Based on the full event history'));
    catchupFails = false; await refresh('events');
    const recovered = await page.evaluate(async () => { const s = await import('./js/store.js'); return { events: s.state.events.length, unread: s.unreadCount(), gap: !!s.state.eventCatchup, older: s.state.olderCursor }; });
    assert.deepEqual(recovered, { events: 61, unread: 50, gap: false, older: null });
    await refresh('events'); assert.equal(await page.evaluate(async () => (await import('./js/store.js')).unreadCount()), 50);
    await go('alerts');
    await page.getByRole('button', { name: /^Mark read/ }).first().click();
    await page.waitForFunction(async () => (await import('./js/store.js')).unreadCount() === 49);
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await page.waitForFunction(async () => (await import('./js/store.js')).unreadCount() === 0);
    assert.equal(await page.getByRole('button', { name: 'Mark all as read' }).count(), 0);
  });
  await check('new run segments are reached through the retained cursor', async () => {
    await go('live');
    runArrival = true; await refresh('runs');
    await page.waitForFunction(() => document.querySelector('.runs li')?.textContent.includes('09:14:00'));
    assert.ok(requests.some(r => r.includes('cursor=' + encodeURIComponent(runsNext.nextCursor))));
    const s = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return { cursor: state.runsCursor, total: state.res.runs.data.items.length }; });
    assert.equal(s.cursor, 'test:runs-tail'); assert.equal(s.total, 41);
  });
  await check('notifications ask permission only after the explicit action', async () => {
    await go('alerts');
    assert.equal(await page.evaluate(() => window.__notificationRequests), 0);
    const button = page.getByRole('button', { name: 'Turn on notifications' });
    if (await button.count()) {
      await button.click();
      assert.equal(await page.evaluate(() => window.__notificationRequests), 1);
    } else assert.equal(await page.evaluate(() => Notification.permission), 'denied');
  });
  await check('three font weights and reduced-motion controls', async () => {
    await go('');
    const weights = await page.evaluate(() => [...new Set([...document.querySelectorAll('main *,header *')].filter(el => el.textContent && el.getBoundingClientRect().height && !el.closest('svg')).map(el => getComputedStyle(el).fontWeight))].sort());
    assert.deepEqual(weights, ['400', '600', '700']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const infinite = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect.getTiming().iterations === Infinity).length);
    assert.equal(infinite, 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${out}/dashboard-1440.png`, fullPage: true });
  });
  await check('first-visit unavailable round sources settle into an error with a retry explanation', async () => {
    allUnavailable = true;
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(fresh); const p = await fresh.newPage();
    await p.goto(base + '#/rounds');
    await p.waitForFunction(() => document.querySelector('#r-round')?.closest('article').textContent.includes('Round data is unavailable'));
    const text = await p.locator('#r-round').evaluate(el => el.closest('article').textContent);
    assert.ok(text.includes('indexer unavailable') && text.includes('retries automatically'));
    assert.ok(!text.includes('Loading round data'));
    await p.screenshot({ path: `${out}/unavailable-round-390.png`, fullPage: false });
    await fresh.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(resourceErrors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ results, errors, resourceErrors, requests }, null, 2));
  console.log(`${results.length} production browser checks passed; no script errors or failed local resources.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
