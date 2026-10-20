/* Garage pin spreading on the archived v1 map — garages that are close together are laid out
   side by side so their pins never overlap, and settle onto their true positions as you zoom in.
   Run: node tests/verify-garage-spread.mjs */
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
}).listen(8963);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/googletagmanager|mochi|atlas\.farhan|cartocdn|openstreetmap|fonts\./, r => r.abort());
await page.route(/unpkg\.com\/leaflet@[^/]+\/dist\/leaflet\.js/, r => r.fulfill({ contentType: 'text/javascript',
  body: readFileSync(FIX + 'leaflet.js', 'utf8') + '\n;L.Map.addInitHook(function(){ window.__lmap = this; });' }));
await page.route(/unpkg\.com\/leaflet@[^/]+\/dist\/leaflet\.css/, r => r.fulfill({ contentType: 'text/css', body: readFileSync(FIX + 'leaflet.css', 'utf8') }));
await page.route(/leaflet-heat/, r => r.fulfill({ contentType: 'text/javascript', body: readFileSync(FIX + 'leaflet-heat.js', 'utf8') }));

await page.goto('http://127.0.0.1:8963/archive/v1/', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.garage-marker-pin').length > 20, null, { timeout: 20000 });

/* In the page: every garage marker with its true position, where it is drawn, and the pin overlap count. */
const snapshot = () => page.evaluate(() => {
  const map = window.__lmap, z = map.getZoom(), isolated = 150, ms = [];
  map.eachLayer(l => { if(l.getElement && l.getElement()?.querySelector?.('.garage-marker-pin') && map.hasLayer(l)) ms.push(l); });
  const pts = ms.map(m => ({ home: m.options.homeLatLng ? map.project(m.options.homeLatLng, z) : null, shown: map.project(m.getLatLng(), z), el: m.getElement() }));
  let overlaps = 0, displaced = 0, wronglyMoved = 0, maxShift = 0;
  for(let i = 0; i < pts.length; i++){
    if(pts[i].home){
      const moved = Math.hypot(pts[i].home.x - pts[i].shown.x, pts[i].home.y - pts[i].shown.y) > 0.5;
      if(moved){
        displaced++;
        maxShift = Math.max(maxShift, Math.hypot(pts[i].home.x - pts[i].shown.x, pts[i].home.y - pts[i].shown.y));
        // A pin with no other garage anywhere near it must stay on its true spot.
        const nearest = Math.min(...pts.filter((q, j) => j !== i && q.home).map(q => Math.hypot(q.home.x - pts[i].home.x, q.home.y - pts[i].home.y)));
        if(nearest > isolated) wronglyMoved++;
      }
    }
    for(let j = i + 1; j < pts.length; j++){
      const a = pts[i].el.querySelector('.garage-marker-pin').getBoundingClientRect(), b = pts[j].el.querySelector('.garage-marker-pin').getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if(w > 2 && h > 2) overlaps++;
    }
  }
  return { zoom: z, pins: pts.length, overlaps, displaced, wronglyMoved, maxShift: Math.round(maxShift) };
});
const setZoom = async z => { await page.evaluate(zz => { window.__lmap.setZoom(zz, { animate: false }); }, z); await page.waitForTimeout(300); };

const start = await snapshot();
console.log(`  start: zoom ${start.zoom}, ${start.pins} pins, ${start.displaced} spread`);
F('garage pins are on the map', start.pins > 50);
F(`at the starting zoom, close garages are spread out (${start.displaced} pins moved)`, start.displaced > 0);
F('at the starting zoom no two garage pins overlap', start.overlaps === 0);

for(const z of [9, 11, 12, 13, 14]){
  await setZoom(z); const s = await snapshot();
  F(`zoom ${z}: no overlapping pins (${s.displaced} spread)`, s.overlaps === 0);
  F(`zoom ${z}: pins with room to spare stay on their true spot`, s.wronglyMoved === 0);
  if(z >= 12) F(`zoom ${z}: spread pins stay close to their true position (${s.maxShift}px)`, s.maxShift <= 40);
}
await setZoom(16); const close = await snapshot();
F('zoom 16: every pin is back on its true position', close.displaced === 0 && close.overlaps === 0);
await setZoom(18); const deep = await snapshot();
F('zoom 18: pins stay on their true positions (only garages on the exact same spot stay apart)', deep.overlaps === 0 && deep.wronglyMoved === 0);

/* a displaced pin still opens its popup */
await setZoom(10);
const target = await page.evaluate(() => {
  const map = window.__lmap, z = map.getZoom(), ms = [];
  map.eachLayer(l => { if(l.options && l.options.homeLatLng && map.hasLayer(l)) ms.push(l); });
  const m = ms.find(x => { const h = map.project(x.options.homeLatLng, z), s = map.project(x.getLatLng(), z); return Math.hypot(h.x - s.x, h.y - s.y) > 4; });
  if(!m) return null;
  const r = m.getElement().getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if(target){
  await page.mouse.click(target.x, target.y); await page.waitForTimeout(600);
  F('clicking a spread-out pin opens its popup', await page.locator('.leaflet-popup').count() === 1);
} else F('found a spread-out pin to click', false);

F('zero page errors', errors.length === 0);
console.log(`\n${pass}/${pass + fail} garage-spread checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
