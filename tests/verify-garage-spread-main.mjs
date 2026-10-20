/* Garage pin spreading on the main app's maps — garages that are close together are laid out side by
   side so their pins never overlap, and settle onto their true positions as you zoom in. Covers the
   Map view and the route-detail map with its "Garages" layer switched on.
   Run: node tests/verify-garage-spread-main.mjs */
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
}).listen(8964);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };

const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType: 'text/javascript', body: readFileSync(FIX + 'leaflet-heat.js', 'utf8') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType: 'text/javascript', body: readFileSync(FIX + 'leaflet.js', 'utf8') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: readFileSync(FIX + 'leaflet.css', 'utf8') });
  return r.abort();
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|\/api\/live\/|mochi|openfreemap/, r => r.abort());
/* The page pins Leaflet with an SRI hash, so its script can't be edited — hook the map constructor instead. */
await page.addInitScript(() => {
  window.__maps = []; let lib;
  Object.defineProperty(window, 'L', { configurable: true, get(){ return lib; }, set(v){ lib = v; try{ v.Map.addInitHook(function(){ window.__maps.push(this); }); }catch{} } });
});

/* Every garage pin on the current map: where it really is, where it is drawn, and how many pairs overlap. */
const snapshot = () => page.evaluate(() => {
  const map = window.__maps.filter(m => document.body.contains(m.getContainer())).pop(), z = map.getZoom(), isolated = 150, ms = [];
  map.eachLayer(l => { if(l.getLatLng && l.options?.icon?.options?.className === 'lb-gpin' && l.getElement()) ms.push(l); });
  const pts = ms.map(m => ({ home: map.project(m.options.homeLatLng ?? m.getLatLng(), z), shown: map.project(m.getLatLng(), z), el: m.getElement() }));
  let overlaps = 0, displaced = 0, wronglyMoved = 0, lonelyMoved = 0, maxShift = 0;
  for(let i = 0; i < pts.length; i++){
    const d = Math.hypot(pts[i].home.x - pts[i].shown.x, pts[i].home.y - pts[i].shown.y);
    if(d > 0.5){
      displaced++; maxShift = Math.max(maxShift, d);
      const nearest = Math.min(...pts.filter((q, j) => j !== i).map(q => Math.hypot(q.home.x - pts[i].home.x, q.home.y - pts[i].home.y)));
      if(nearest > isolated) wronglyMoved++;   // a pin with no neighbour near it must stay on its true spot
      if(nearest > 40) lonelyMoved++;          // …and close up, a pin only stays apart when another garage is on the same spot
    }
    for(let j = i + 1; j < pts.length; j++){
      const a = pts[i].el.getBoundingClientRect(), b = pts[j].el.getBoundingClientRect();
      if(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) overlaps++;
    }
  }
  return { zoom: z, pins: pts.length, overlaps, displaced, wronglyMoved, lonelyMoved, maxShift: Math.round(maxShift) };
});
const setZoom = async z => {
  await page.evaluate(zz => { window.__maps.filter(m => document.body.contains(m.getContainer())).pop().setZoom(zz, { animate: false }); }, z);
  await page.waitForTimeout(400);
};

async function sweep(label){
  const start = await snapshot();
  console.log(`  ${label}: zoom ${start.zoom}, ${start.pins} pins, ${start.displaced} spread`);
  F(`${label}: garage pins are shown (${start.pins})`, start.pins > 20);
  F(`${label}: close garages are spread out at the starting zoom (${start.displaced} moved)`, start.displaced > 0);
  F(`${label}: no overlapping pins at the starting zoom`, start.overlaps === 0);
  for(const z of [9, 10, 12, 13, 14]){
    await setZoom(z); const s = await snapshot();
    F(`${label}: zoom ${z}: no overlapping pins (${s.displaced} spread)`, s.overlaps === 0);
    F(`${label}: zoom ${z}: pins with room to spare stay on their true spot`, s.wronglyMoved === 0);
    if(z >= 12) F(`${label}: zoom ${z}: spread pins stay close to their true position (${s.maxShift}px)`, s.maxShift <= 40);
  }
  await setZoom(17); const close = await snapshot();
  F(`${label}: zoom 17: pins are back on their true positions, except garages on exactly the same spot (${close.displaced})`, close.overlaps === 0 && close.lonelyMoved === 0 && close.displaced <= 6);
}

/* 1 — the Map view */
await page.goto('http://127.0.0.1:8964/#/map', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.lb-gpin').length > 20, null, { timeout: 25000 });
await sweep('Map view');
await setZoom(10);
const target = await page.evaluate(() => {
  const map = window.__maps.filter(m => document.body.contains(m.getContainer())).pop(), z = map.getZoom(), ms = [];
  map.eachLayer(l => { if(l.getLatLng && l.options?.icon?.options?.className === 'lb-gpin') ms.push(l); });
  const m = ms.find(x => { const h = map.project(x.options.homeLatLng, z), s = map.project(x.getLatLng(), z); return Math.hypot(h.x - s.x, h.y - s.y) > 4; });
  if(!m) return null;
  const r = m.getElement().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if(target){
  await page.mouse.click(target.x, target.y); await page.waitForTimeout(700);
  F('Map view: clicking a spread-out pin opens its popup', await page.locator('.leaflet-popup').count() === 1);
} else F('Map view: found a spread-out pin to click', false);

/* 2 — the route-detail map with every garage switched on */
await page.goto('http://127.0.0.1:8964/#/route/422', { waitUntil: 'load' });
await page.waitForFunction(() => { const b = document.getElementById('closestBtn'); return b && !b.disabled; }, null, { timeout: 25000 });
await page.click('#closestBtn'); await page.waitForTimeout(1200);
await sweep('Route 422 with the Garages layer');

F('zero page errors', errors.length === 0);
console.log(`\n${pass}/${pass + fail} main-map garage-spread checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
