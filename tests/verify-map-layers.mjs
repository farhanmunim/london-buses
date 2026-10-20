/* Layers on the network map (#/map) — the route view's layers, available network-wide.
   · 1–3 routes searched/filtered → "focused": layers show what is near those routes; live buses and
     stops are available (live buses polls the API once per route — never for more than three).
   · otherwise → "network": nothing heavy is fetched until a layer is switched on; the dense layers
     (low bridges, collisions, street works, traffic orders) draw only what is on screen once zoomed in.
   Run: node tests/verify-map-layers.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const FIX = join(ROOT, 'tests/fixtures/');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.geojson':'application/json', '.svg':'image/svg+xml' };
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  }catch{ try{ res.writeHead(404); }catch{} res.end('nf'); }
}).listen(8965);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };
const json = p => JSON.parse(readFileSync(join(ROOT, 'data/api', p), 'utf8'));

/* a real location for each dataset, so zoomed-in views have something to show */
const bridge = json('bridges.json').bridges.find(b => Number.isFinite(b.lat) && Number.isFinite(b.lng));
const troPoint = json('dtro.json').orders.flatMap(o => (o.provisions ?? []).flatMap(p => (p.places ?? []).filter(pl => pl.type !== 'diversionRoute' && pl.coords?.length).map(pl => pl.coords[0])))[0];
const sw = (() => {
  const d = json('streetworks-history.json'), cut = new Date(Date.now() - 3 * 864e5).toISOString();
  const ix = Object.fromEntries(d.fields.map((f, i) => [f, i]));
  const val = (r, f) => { const v = r[ix[f]]; return d.enums?.[f] ? (v >= 0 ? d.enums[f][v] : null) : v; };
  const row = d.rows.find(r => { const c = r[ix.coords]; const end = val(r, 'actual_end_date_time') ?? val(r, 'proposed_end_date') ?? val(r, 'end_date'); return c?.length && (!end || end >= cut) && val(r, 'work_status') !== 'Works completed'; });
  return row[ix.coords][0];
})();

const requests = [];
async function openMap(vp, { clock = false } = {}){
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.route('**://unpkg.com/**', r => {
    const u = r.request().url();
    if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType: 'text/javascript', body: readFileSync(FIX + 'leaflet-heat.js', 'utf8') });
    if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType: 'text/javascript', body: readFileSync(FIX + 'leaflet.js', 'utf8') });
    if(u.endsWith('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: readFileSync(FIX + 'leaflet.css', 'utf8') });
    return r.abort();
  });
  await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|mochi|openfreemap/, r => r.abort());
  await page.route(/api\.tfl\.gov\.uk\/StopPoint\/[^/]+\/Arrivals/, r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([5, 2, 9, 1].map((m, i) => ({ lineName: '25', destinationName: 'Test Dest ' + i, timeToStation: m * 60, expectedArrival: new Date(Date.now() + m * 60000).toISOString() }))) }));
  /* a stand-in for the live-bus endpoint, so polling can be counted without a network */
  await page.route('**/api/live/vehicles?line=*', r => {
    const line = new URL(r.request().url()).searchParams.get('line');
    requests.push({ line, t: Date.now() });
    return r.fulfill({ contentType: 'application/json', headers: { 'cache-control': 'max-age=15' }, body: JSON.stringify({
      feed: 'vehicles', live: true, capturedAt: new Date().toISOString(), count: 2,
      data: [{ reg: 'LK00AAA', line, direction: '1', lat: 51.51, lng: -0.12, bearing: 90, destination: 'Test' }, { reg: 'LK00AAB', line, direction: '2', lat: 51.52, lng: -0.10, bearing: 270, destination: 'Test' }] }) });
  });
  await page.addInitScript(() => {
    window.__maps = []; let lib;
    Object.defineProperty(window, 'L', { configurable: true, get(){ return lib; }, set(v){ lib = v; try{ v.Map.addInitHook(function(){ window.__maps.push(this); }); }catch{} } });
  });
  page.on('request', r => { const u = r.url(); if(/\/data\/api\//.test(u)) requests.push({ data: u.split('/data/api/')[1], t: Date.now() }); });
  if(clock) await page.clock.install();
  await page.goto('http://127.0.0.1:8965/#/map', { waitUntil: 'load' });
  await page.waitForSelector('#nmLayers [data-lyr]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-interactive, .leaflet-marker-icon').length > 20, null, { timeout: 25000 });
  return { ctx, page };
}
const view = (page, lat, lng, z) => page.evaluate(([la, ln, zz]) => { window.__maps.filter(m => document.body.contains(m.getContainer())).pop().setView([la, ln], zz, { animate: false }); }, [lat, lng, z]);
const zoom = (page, z) => page.evaluate(zz => { window.__maps.filter(m => document.body.contains(m.getContainer())).pop().setZoom(zz, { animate: false }); }, z);
const note = (page, k) => page.evaluate(kk => document.querySelector(`#nmLNotes [data-lyr="${kk}"]`)?.textContent ?? '', k);
const btn = (page, k) => page.evaluate(kk => { const b = document.querySelector(`#nmLayers [data-lyr="${kk}"]`); return { on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), gated: b.getAttribute('aria-disabled') === 'true', label: b.getAttribute('aria-label') }; }, k);
const count = (page, test) => page.evaluate(src => { const map = window.__maps.filter(m => document.body.contains(m.getContainer())).pop(); const f = new Function('l', 'return ' + src); let n = 0; map.eachLayer(l => { try{ if(f(l)) n++; }catch{} }); return n; }, test);
const settled = (page, k) => page.waitForFunction(kk => { const n = document.querySelector(`#nmLNotes [data-lyr="${kk}"]`); return n && !/^Loading/.test(n.textContent); }, k, { timeout: 30000 });
const click = async (page, k, opts = {}) => { await page.click(`#nmLayers [data-lyr="${k}"]`, opts); await page.waitForTimeout(500); };
const addRoutes = async (page, text) => { await page.fill('#nmq', text); await page.press('#nmq', 'Enter'); await page.waitForTimeout(900); };
const inView = n => Number((/^([\d,]+)/.exec(n.replace(/^.*?(\d[\d,]*) (?:height|serious|street|order)/, '$1 ')) ?? [])[1]?.replace(/,/g, '') ?? NaN);

/* ── 1 · the controls ───────────────────────────────────────────────────── */
{
  const { ctx, page } = await openMap({ width: 1280, height: 800 });
  const labels = await page.$$eval('#nmLayers [data-lyr]', bs => bs.map(b => b.getAttribute('aria-label')));
  F(`the Layers row has all seven layers (${labels.join(', ')})`, labels.length === 7 && ['Garages', 'Stops', 'Live buses', 'Low bridges', 'Incidents', 'Street works', 'Traffic orders'].every(l => labels.includes(l)));
  F('with no routes narrowed, Live buses and Stops are gated', (await btn(page, 'live')).gated && (await btn(page, 'stops')).gated);
  F('with no routes narrowed, the other layers are available', !(await btn(page, 'bridges')).gated && !(await btn(page, 'inc')).gated && !(await btn(page, 'sw')).gated && !(await btn(page, 'tro')).gated);
  const fetchedBefore = requests.filter(r => /bridges|accidents|streetworks|dtro|route-stops/.test(r.data ?? '')).length;
  F('nothing heavy is fetched until a layer is switched on', fetchedBefore === 0);

  await click(page, 'live', { force: true });   // aria-disabled, but a user can still click it
  F('clicking gated Live buses explains why and does not poll', /1–3 routes/.test(await note(page, 'hint')) && !(await btn(page, 'live')).on && requests.filter(r => r.line).length === 0);

  /* ── 2 · network mode: dense layers are gated by zoom ─────────────────── */
  await click(page, 'bridges');
  F('Low bridges at the starting zoom asks you to zoom in', /Zoom in/.test(await note(page, 'bridges')) && (await count(page, 'l.options?.icon?.options?.html?.includes("rotate(45deg)")')) === 0);
  await view(page, bridge.lat, bridge.lng, 14); await page.waitForTimeout(700);
  const nb = await count(page, 'l.options?.icon?.options?.html?.includes("rotate(45deg)")');
  F(`zoomed in on a bridge, low bridges are drawn (${nb}) and the note counts them`, nb >= 1 && nb <= 700 && /in view/.test(await note(page, 'bridges')));
  await zoom(page, 10); await page.waitForTimeout(700);
  F('zooming back out removes the bridges again', (await count(page, 'l.options?.icon?.options?.html?.includes("rotate(45deg)")')) === 0 && /Zoom in/.test(await note(page, 'bridges')));
  await click(page, 'bridges');
  F('switching Low bridges off clears them and their note', !(await btn(page, 'bridges')).on && (await note(page, 'bridges')) === '');

  await click(page, 'inc');
  F('Incidents shows a London-wide heatmap at the starting zoom', await page.locator('.leaflet-heatmap-layer').count() >= 1 && /Collision density/.test(await note(page, 'inc')));
  const graveBefore = await count(page, 'l.options?.fillColor === "#ea580c" || l.options?.fillColor === "#111827"');
  await view(page, 51.5074, -0.1278, 14); await page.waitForTimeout(800);
  const graveAfter = await count(page, 'l.options?.fillColor === "#ea580c" || l.options?.fillColor === "#111827"');
  F(`serious and fatal collisions only appear once zoomed in (${graveBefore} → ${graveAfter})`, graveBefore === 0 && graveAfter > 0 && graveAfter <= 600);
  await click(page, 'inc');
  F('switching Incidents off removes the heatmap', await page.locator('.leaflet-heatmap-layer').count() === 0);

  await zoom(page, 11); await page.waitForTimeout(300);   // back to the starting zoom
  await click(page, 'sw'); await settled(page, 'sw');
  F('Street works at the starting zoom asks you to zoom in', /Zoom in/.test(await note(page, 'sw')));
  await view(page, sw[0], sw[1], 15); await page.waitForTimeout(1200);
  const nsw = inView(await note(page, 'sw'));
  F(`zoomed in on a street work, works are drawn (${nsw}, capped at 400)`, nsw >= 1 && nsw <= 401);
  await click(page, 'sw');

  await zoom(page, 11); await page.waitForTimeout(300);
  await click(page, 'tro'); await settled(page, 'tro');
  F('Traffic orders at the starting zoom asks you to zoom in', /Zoom in/.test(await note(page, 'tro')));
  await view(page, troPoint[0], troPoint[1], 15); await page.waitForTimeout(1200);
  const ntro = inView(await note(page, 'tro'));
  F(`zoomed in on a traffic order, orders are drawn (${ntro}, capped at 400)`, ntro >= 1 && ntro <= 401);
  await click(page, 'tro');

  F('no live-bus request was made in network mode', requests.filter(r => r.line).length === 0);
  F('zero page errors (network mode)', page.errors.length === 0);
  await ctx.close();
}

/* ── 3 · focused mode: 1–3 routes ─────────────────────────────────────────── */
{
  requests.length = 0;
  const { ctx, page } = await openMap({ width: 1280, height: 800 }, { clock: true });
  await addRoutes(page, '25');
  F('one route focused: Live buses and Stops become available', !(await btn(page, 'live')).gated && !(await btn(page, 'stops')).gated);

  /* garages: start on, narrowed to the focused route, with a simple switch to all */
  await page.waitForTimeout(500);
  const gCount = () => page.locator('.leaflet-marker-icon:has(span:text-matches("^\\([A-Z]+\\)$"))').count();
  const gNarrow = await gCount();
  F(`focused route: Garages shows only its own garage(s) (${gNarrow}) and the switch appears`, gNarrow >= 1 && gNarrow <= 2 && await page.locator('#nmGarScope').isVisible());
  await page.locator('#nmGarScope [data-gs="all"]').click(); await page.waitForTimeout(400);
  const gAll = await gCount();
  F(`"All garages" shows every garage (${gAll})`, gAll > 20 && /garages/.test(await note(page, 'garages')));
  await page.locator('#nmGarScope [data-gs="route"]').click(); await page.waitForTimeout(400);
  F('"Selected routes" narrows again', (await gCount()) === gNarrow);

  await click(page, 'stops');
  F('Stops shows that route\'s stops', /^\d+ stops?$/.test(await note(page, 'stops')));

  await page.evaluate(() => { const m = window.__maps[0]; let done = false; m.eachLayer(l => { if(!done && l.options?.radius === 4.5 && l.fire){ l.fire('click'); l.openPopup(); done = true; } }); });
  await page.waitForTimeout(600);
  const sp = await page.locator('.leaflet-popup-content').innerText();
  F('a stop pin opens a popup with its next three buses and a link to the full board', (await page.locator('.leaflet-popup-content .rchip').count()) === 3 && /1 min/.test(sp) && /See all live arrivals/.test(sp) && !/Loading/.test(sp));
  await page.evaluate(() => { window.__maps[0].closePopup(); });
  await click(page, 'live'); await page.waitForTimeout(800);
  const polls1 = requests.filter(r => r.line === '25').length;
  F(`switching Live buses on polls once for the route (${polls1}) and draws the buses`, polls1 === 1 && (await page.locator('.lb-bus').count()) === 2 && /live bus/.test(await note(page, 'live')));
  F('the note counts down to the next update', /next update in \d+ s/.test(await note(page, 'live')));

  await page.clock.runFor(16000); await page.waitForTimeout(500);
  const polls2 = requests.filter(r => r.line === '25').length;
  F(`it polls again after about 15 s (${polls2} requests so far)`, polls2 === 2);

  const mark = requests.length;
  await addRoutes(page, '88, N38');
  await page.clock.runFor(400); await page.waitForTimeout(600);
  const fresh = requests.slice(mark).filter(r => r.line);
  F(`adding two routes at once rebuilds once: one request per route (${fresh.map(r => r.line).join(', ')})`, fresh.length === 3 && new Set(fresh.map(r => r.line)).size === 3);
  F('the buses are drawn for all three routes', (await page.locator('.lb-bus').count()) === 6);

  await addRoutes(page, '10'); await page.clock.runFor(400);
  const gatedNow = await btn(page, 'live');
  F('a fourth route switches Live buses off, clears the buses and gates the button', gatedNow.gated && !gatedNow.on && (await page.locator('.lb-bus').count()) === 0 && (await note(page, 'live')) === '');
  const stopsGone = await btn(page, 'stops');
  F('…and Stops too', stopsGone.gated && !stopsGone.on);
  const before = requests.filter(r => r.line).length;
  await page.clock.runFor(60000); await page.waitForTimeout(500);
  F(`no further live requests once it is off (${requests.filter(r => r.line).length - before} new in 60 s)`, requests.filter(r => r.line).length === before);

  /* the other layers follow the focused routes */
  await page.click('#nmReset'); await page.waitForTimeout(600);
  await addRoutes(page, '25'); await page.clock.runFor(400);
  await click(page, 'bridges'); await click(page, 'inc'); await page.waitForTimeout(800);
  F('focused: Low bridges counts those near the route', /low bridges? within 300 m/.test(await note(page, 'bridges')));
  F('focused: Incidents counts the collisions near the route', /within 150 m/.test(await note(page, 'inc')) && /collision/.test(await note(page, 'inc')));
  await click(page, 'sw'); await click(page, 'tro'); await settled(page, 'sw'); await settled(page, 'tro');
  F('focused: Street works and Traffic orders report for the route', /within 150 m/.test(await note(page, 'sw')) && /traffic orders? nearby/.test(await note(page, 'tro')));
  F('zero page errors (focused mode)', page.errors.length === 0);
  await ctx.close();
}

/* ── 4 · responsive ────────────────────────────────────────────────────────── */
for(const [name, vp] of [['phone', { width: 390, height: 844 }], ['small phone', { width: 320, height: 640 }], ['tablet', { width: 820, height: 1100 }], ['desktop', { width: 1280, height: 800 }]]){
  const { ctx, page } = await openMap(vp);
  await addRoutes(page, '25');
  await click(page, 'bridges'); await click(page, 'stops'); await click(page, 'inc');
  const m = await page.evaluate(() => {
    const panel = document.getElementById('nmPanel').getBoundingClientRect(), wrap = document.querySelector('.netmap-wrap').getBoundingClientRect();
    const bs = [...document.querySelectorAll('#nmLayers [data-lyr]')].map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, inPanel: r.left >= panel.left - 1 && r.right <= panel.right + 1 }; });
    return { panelInside: panel.left >= -1 && panel.right <= innerWidth + 1 && panel.bottom <= wrap.bottom + 1, scrollsX: document.documentElement.scrollWidth > innerWidth + 1, buttons: bs };
  });
  F(`${name} (${vp.width}px): the layer buttons are all inside the panel and big enough to tap`, m.buttons.length === 7 && m.buttons.every(b => b.inPanel && b.w >= 30 && b.h >= 30));
  F(`${name}: the panel fits the screen and nothing scrolls sideways`, m.panelInside && !m.scrollsX);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} map-layer checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
