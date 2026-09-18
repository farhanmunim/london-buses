/* Street works page — the DfT Street Manager archive table, driven in a real
   browser against the committed data. Run: node tests/verify-streetworks.mjs */
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
}).listen(8917);

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

await page.goto('http://127.0.0.1:8917/#/streetworks', { waitUntil:'load' });
await page.waitForTimeout(1500);

F('page renders h1', /Street works/.test(await txt('h1')));
const count = await txt('#swCount');
F(`count line shows works (${count.trim()})`, /\d+ works?/.test(count));
const rows0 = await page.locator('#swBody tr').count();
F(`table has rows (${rows0})`, rows0 > 0);

// Borough filter narrows
const opts = await page.locator('#swha option').allTextContents();
F(`borough select populated (${opts.length - 1} boroughs)`, opts.length > 5);
await page.selectOption('#swha', { index: 1 });
await page.waitForTimeout(300);
const c1 = await txt('#swCount');
F(`borough filter narrows (${c1.trim()})`, /\(of \d+\)/.test(c1));
await page.selectOption('#swha', '');
await page.waitForTimeout(200);

// Search matches — term taken from the committed data so growth never breaks it
const firstStreet = JSON.parse(readFileSync(join(ROOT, 'data/api/streetworks-history.json'), 'utf8'))
  .entries.map(e => e.latest?.street_name).find(Boolean);
await page.fill('#swq', String(firstStreet).slice(0, 8));
await page.waitForTimeout(400);
const c2 = (await txt('#swCount')).trim();
F(`street search matches ("${firstStreet}" → ${c2})`, /^[1-9]\d* work/.test(c2));
await page.fill('#swq', '');
await page.waitForTimeout(400);

// Category filter
await page.selectOption('#swcat', 'Major');
await page.waitForTimeout(300);
F('category filter applies', /\(of \d+\)|works?/.test(await txt('#swCount')));
await page.selectOption('#swcat', '');
await page.waitForTimeout(200);

// CSV export
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await page.click('#swExport');
F('CSV export downloads', !!(await dl));

// Nav: More sheet contains and highlights Street works
await page.click('#moreBtn').catch(() => page.click('#moreTab'));
await page.waitForTimeout(200);
const sheetHasLink = await page.locator('#moreSheet a[data-nav="streetworks"]').count();
F('More sheet lists Street works', sheetHasLink === 1);
F('nav entry highlighted', await page.locator('a[data-nav="streetworks"].on').count() >= 1);

// Diversions page cross-link
await page.goto('http://127.0.0.1:8917/#/diversions', { waitUntil:'load' });
await page.waitForTimeout(1200);
F('diversions page links to street works', await page.locator('a[href="#/streetworks"]').count() >= 1);

// Route-map layer: the cone toggle draws the layer and reports a note
// (count depends on live data, so assert the note text, not a number).
await page.goto('http://127.0.0.1:8917/#/route/1', { waitUntil:'load' });
await page.waitForTimeout(2500);
const btn = page.locator('#swMapBtn');
F('route map has street-works toggle (enabled)', await btn.count() === 1 && await btn.isEnabled());
await btn.click();
await page.waitForTimeout(1200);
const note = (await page.locator('#swNote').textContent().catch(() => '')) ?? '';
F(`street-works layer reports (${note.trim().slice(0, 60)}…)`, /street work/.test(note) && /Street Manager|archive/.test(note));
await btn.click();
await page.waitForTimeout(400);
F('street-works layer toggles off (note removed)', await page.locator('#swNote').count() === 0);

F('zero page errors', errors.length === 0);
if(errors.length) console.log('errors:', errors);
console.log(`${pass}/${pass+fail} checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
