/* Live-surface resilience suite — the arrivals board and live-bus layers
   must survive a flapping feed (as seen 2026-08-27) by keeping last-good
   data and retrying quietly. Post-migration: static datasets are served
   natively from the repo's own data/api/, arrivals + status are mocked at
   api.tfl.gov.uk, and live vehicles at this site's /api/live/vehicles.
   Run: node tests/verify-live-resilience.mjs   (serves the repo itself). */
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
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8901);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1280,height:900} })).newPage();
const state = { failArrivals: false, failVehicles: false };
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
let atlasLeaks = 0;
await page.route('**://atlas.farhan.app/**', r => { atlasLeaks++; return r.fulfill({ status:410, body:'gone' }); });
await page.route('**://api.tfl.gov.uk/StopPoint/**', r => {
  if(state.failArrivals) return r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' });
  const arr = JSON.parse(payload('arrivals.json')).data ?? [];
  arr.forEach((p,i) => { p.expectedArrival = new Date(Date.now() + (60 + i*80)*1000).toISOString(); p.timeToStation = 60 + i*80; });
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=30'}, body: JSON.stringify(arr) });
});
await page.route('**://api.tfl.gov.uk/Line/**', r =>
  r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' }));   // status must degrade via snapshot
await page.route('**/api/live/vehicles*', r => {
  if(state.failVehicles) return r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' });
  const line = new URL(r.request().url()).searchParams.get('line');
  const v = { feed:'vehicles', live:true, capturedAt:new Date().toISOString(),
    data: line === '25' ? [{ reg:'LV25TST', lat:51.53, lng:-0.02, bearing:90, direction:'1', destination:'Test', publishedLine:'25' }] : [] };
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=15'}, body: JSON.stringify(v) });
});
await page.route(/cartocdn|openstreetmap\.org|fonts\./, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
const checks = {}; let pass = 0, fail = 0;
const F = (k, ok) => { checks[k] = ok; console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

/* ── stop board: render → outage → reconnect → recovery ── */
const stopId = JSON.parse(payload('arrivals.json')).data[0].naptanId;
await page.goto('http://127.0.0.1:8901/v2/#/stop/' + stopId, { waitUntil:'load' }); await page.waitForTimeout(3500);
const rows0 = await page.evaluate(() => document.querySelectorAll('#arrBoard > div').length);
F('board renders arrivals (' + rows0 + ' rows)', rows0 > 0);
const next0 = await page.evaluate(() => document.getElementById('nextUpd')?.textContent ?? '');
const nextS = +(next0.match(/in (\d+) s/)?.[1] ?? 999);
F('poll aligned to feed TTL (' + next0 + ')', nextS >= 20 && nextS <= 35);
state.failArrivals = true;
await page.waitForTimeout(36000);   // past the ~31 s TTL-aligned poll, so a failed poll has happened
const during = await page.evaluate(() => ({ rows: document.querySelectorAll('#arrBoard > div').length,
  note: document.getElementById('nextUpd')?.textContent,
  unreachable: document.getElementById('main').textContent.includes('unreachable') }));
F('outage keeps the board (' + during.rows + '/' + rows0 + ', "' + during.note + '")',
  during.rows === rows0 && during.note === 'reconnecting…' && !during.unreachable);
state.failArrivals = false;
await page.waitForTimeout(10000);
const after = await page.evaluate(() => document.getElementById('nextUpd')?.textContent ?? '');
F('board recovers ("' + after + '")', /next update in \d+ s|updating/.test(after));

/* ── route page: status 502 degrades to snapshot; live buses sticky ── */
await page.goto('http://127.0.0.1:8901/v2/#/route/25', { waitUntil:'load' }); await page.waitForTimeout(3500);
const statusTxt = await page.evaluate(() => document.getElementById('dstatus')?.textContent.trim() ?? '');
F('status falls back to snapshot when live 502s ("' + statusTxt.slice(0,30) + '")', statusTxt.length > 0);
await page.evaluate(() => document.getElementById('liveBtn')?.click()); await page.waitForTimeout(2500);
const bus0 = await page.evaluate(() => document.querySelectorAll('#map .lb-bus').length);
state.failVehicles = true;
await page.waitForTimeout(17000);
const busDuring = await page.evaluate(() => ({ n: document.querySelectorAll('#map .lb-bus').length,
  note: document.getElementById('busLiveText')?.textContent ?? '' }));
state.failVehicles = false;
F('live buses survive a feed outage (' + busDuring.n + '/' + bus0 + ', "' + busDuring.note + '")',
  bus0 > 0 && busDuring.n === bus0 && /reconnecting|next update/.test(busDuring.note));
F('zero page errors', errors.length === 0);
F('no requests reached atlas.farhan.app (' + atlasLeaks + ')', atlasLeaks === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} resilience checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
