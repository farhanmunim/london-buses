/* Hazard-layer suite — the route map's "Low bridges" and "Incidents"
   toggles must draw corridor-filtered markers from the seeded snapshots.
   Run: node tests/verify-hazards.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const FIX = join(ROOT, 'tests/fixtures/');
const payload = f => readFileSync(FIX + f, 'utf8');
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8905);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1280,height:900} })).newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: payload('leaflet-heat.js') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
await page.route(/atlas\.farhan\.app|cartocdn|openstreetmap\.org|fonts\.|api\.tfl\.gov\.uk|\/api\/live\//, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

await page.goto('http://127.0.0.1:8905/v2/#/route/1', { waitUntil:'load' }); await page.waitForTimeout(3500);

const btns = await page.evaluate(() => ['stopsBtn','liveBtn','closestBtn','bridgeBtn','incBtn'].map(id => {
  const b = document.getElementById(id);
  return { id, title: b?.title ?? '', text: (b?.textContent ?? '').trim() };
}));
F('trigger buttons are icon-only with tooltips', btns.every(b => b.title.length > 2 && b.text === ''));

await page.evaluate(() => document.getElementById('bridgeBtn')?.click()); await page.waitForTimeout(2500);
const br = await page.evaluate(() => ({
  on: document.getElementById('bridgeBtn')?.classList.contains('on'),
  note: document.getElementById('bridgeNote')?.textContent ?? '',
}));
F('bridge toggle on + note ("' + br.note.slice(0,60) + '")', br.on && /height restriction/.test(br.note));

// Click a bridge glyph (real DOM element) → detail popup opens
await page.evaluate(() => {
  const glyphs = [...document.querySelectorAll('#map .leaflet-marker-icon')];
  const g = glyphs.find(x => x.innerHTML.includes('rotate(45deg)'));
  g?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(800);
const pop = await page.evaluate(() => document.querySelector('#map .leaflet-popup')?.textContent ?? '');
F('bridge click opens detail popup ("' + pop.slice(0,50).replace(/\s+/g,' ') + '")', /Height/.test(pop));

await page.evaluate(() => document.getElementById('incBtn')?.click()); await page.waitForTimeout(3500);
const inc = await page.evaluate(() => ({
  on: document.getElementById('incBtn')?.classList.contains('on'),
  note: document.getElementById('incNote')?.textContent ?? '',
  heat: !!document.querySelector('#map .leaflet-heatmap-layer'),
}));
F('incidents toggle on + note ("' + inc.note.slice(0,80) + '")', inc.on && /collision/.test(inc.note) && /STATS19|No recorded/.test(inc.note));
F('incident density renders as heatmap canvas', inc.heat);
F('note explains heat + clickable serious/fatal dots', /heatmap/.test(inc.note) && /serious/.test(inc.note) && /fatal/.test(inc.note));

const legend = await page.evaluate(() => document.getElementById('bridgeNote')?.innerHTML ?? '');
F('bridge legend carries height-band chips', /#dc2626/.test(legend) && /#f59e0b/.test(legend) && /4\.2/.test(legend));

await page.evaluate(() => { document.getElementById('bridgeBtn')?.click(); document.getElementById('incBtn')?.click(); });
await page.waitForTimeout(800);
const off = await page.evaluate(() => ({
  b: !!document.getElementById('bridgeNote'), i: !!document.getElementById('incNote'),
  bon: document.getElementById('bridgeBtn')?.classList.contains('on'),
}));
F('toggles clear layers + notes', !off.b && !off.i && !off.bon);
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} hazard checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
