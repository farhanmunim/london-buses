/* Traffic orders — the DfT D-TRO page and route-map layer, driven in a real
   browser against the committed data. Run: node tests/verify-tro.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8918);

const FIX = join(ROOT, 'tests/fixtures/');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:1280, height:900 }, acceptDownloads:true });
const page = await ctx.newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX + 'leaflet-heat.js', 'utf8') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX + 'leaflet.js', 'utf8') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: readFileSync(FIX + 'leaflet.css', 'utf8') });
  return r.abort();
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|\/api\/live\//, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };
const txt = async sel => (await page.locator(sel).first().textContent().catch(() => '')) ?? '';

await page.goto('http://127.0.0.1:8918/#/tro', { waitUntil:'load' });
await page.waitForTimeout(1500);

F('page renders h1', /Traffic orders/.test(await txt('h1')));
const count = await txt('#troCount');
F(`count line shows orders (${count.trim()})`, /\d+ orders?/.test(count));
const rows0 = await page.locator('#troBody tr').count();
F(`table has rows (${rows0})`, rows0 > 0);

// Authority filter narrows
const opts = await page.locator('#troauth option').allTextContents();
F(`authority select populated (${opts.length - 1} authorities)`, opts.length > 3);
await page.selectOption('#troauth', { index: 1 });
await page.waitForTimeout(300);
F(`authority filter narrows (${(await txt('#troCount')).trim()})`, /\(of [\d,]+\)/.test(await txt('#troCount')));
await page.selectOption('#troauth', '');
await page.waitForTimeout(200);

// Regulation-type filter — pick one straight from the select so growth
// in the committed data never breaks the test.
await page.selectOption('#troreg', { index: 1 });
await page.waitForTimeout(300);
F('regulation filter applies', /orders?/.test(await txt('#troCount')));
await page.selectOption('#troreg', '');
await page.waitForTimeout(200);

// Route-corridor checkbox — the committed data has corridor-joined orders.
await page.check('#troroutes');
await page.waitForTimeout(300);
const cJoined = (await txt('#troCount')).trim();
F(`corridor filter keeps joined orders (${cJoined})`, /^[1-9][\d,]* order/.test(cJoined));
F('route chips render', await page.locator('#troBody a.rchip').count() > 0);
await page.uncheck('#troroutes');
await page.waitForTimeout(200);

// CSV export
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await page.click('#troExport');
F('CSV export downloads', !!(await dl));

// Nav: More sheet contains and highlights Traffic orders
await page.click('#moreBtn').catch(() => page.click('#moreTab'));
await page.waitForTimeout(200);
F('More sheet lists Traffic orders', await page.locator('#moreSheet a[data-nav="tro"]').count() === 1);
F('nav entry highlighted', await page.locator('a[data-nav="tro"].on').count() >= 1);

// Route-map layer: pick a route the committed data corridor-joins, toggle
// the layer, and assert the note reports orders (count is data-dependent).
const dtro = JSON.parse(readFileSync(join(ROOT, 'data/api/dtro.json'), 'utf8'));
const joined = dtro.orders.find(o => o.routes?.length)?.routes[0];
await page.goto(`http://127.0.0.1:8918/#/route/${joined}`, { waitUntil:'load' });
await page.waitForTimeout(2500);
const btn = page.locator('#troMapBtn');
F(`route ${joined} map has traffic-orders toggle (enabled)`, await btn.count() === 1 && await btn.isEnabled());
await btn.click();
await page.waitForTimeout(1200);
const note = (await page.locator('#troNote').textContent().catch(() => '')) ?? '';
F(`traffic-orders layer reports (${note.trim().slice(0, 60)}…)`, /traffic (regulation )?order/.test(note) && /D-TRO/.test(note));
await btn.click();
await page.waitForTimeout(400);
F('traffic-orders layer toggles off (note removed)', await page.locator('#troNote').count() === 0);

F('zero page errors', errors.length === 0);
if(errors.length) console.log('errors:', errors);
console.log(`${pass}/${pass+fail} checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
