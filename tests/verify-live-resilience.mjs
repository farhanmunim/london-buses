/* Live-surface resilience suite — the arrivals board and live-bus layers
   must survive a flapping feed (as seen 2026-08-27: TfL-proxy endpoints at
   ~1-in-3 success) by keeping last-good data and retrying quietly.
   Run: node tests/verify-live-resilience.mjs   (serves the repo itself;
   fixtures in tests/fixtures, refreshed from the live Atlas API). */
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

const API_FILES = {
  '/routes':'routes.json','/route-meta':'route-meta.json','/route-stops':'route-stops.json',
  '/routes-overview':'routes-overview.json','/line-status':'line-status.json','/garages':'garages.json',
  '/fleet':'fleet.json','/vehicles':'vehicles.json','/tenders':'tenders.json','/manifest':'manifest.json',
  '/history/reliability-tracked':'rt-25.json',
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1280,height:900} })).newPage();
const state = { failArrivals: false, failVehicles: false };
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
await page.route('**://atlas.farhan.app/**', r => {
  const key = new URL(r.request().url()).pathname.replace('/api/v1','');
  if(key === '/live/arrivals'){
    if(state.failArrivals) return r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' });
    const j = JSON.parse(payload('arrivals.json'));
    j.capturedAt = new Date(Date.now() - 22000).toISOString();
    (j.data ?? []).forEach((p,i) => { p.expectedArrival = new Date(Date.now() + (60 + i*80)*1000).toISOString(); p.timeToStation = 60 + i*80; });
    return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=30'}, body: JSON.stringify(j) });
  }
  if(key === '/live/vehicles'){
    if(state.failVehicles) return r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' });
    const line = new URL(r.request().url()).searchParams.get('line');
    const v = { feed:'vehicles', live:true, capturedAt:new Date().toISOString(),
      data: line === '25' ? [{ reg:'LV25TST', lat:51.53, lng:-0.02, bearing:90, direction:'1', destination:'Test', publishedLine:'25' }] : [] };
    return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=15'}, body: JSON.stringify(v) });
  }
  if(key === '/live/status') return r.fulfill({ status:502, contentType:'text/plain', body:'error code: 502' });   // status must degrade via snapshot
  const f = API_FILES[key];
  return f ? r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body: payload(f) })
           : r.fulfill({ status:404, contentType:'application/json', body:'{}' });
});
await page.route(/cartocdn|fonts\./, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
const checks = {}; let pass = 0, fail = 0;
const F = (k, ok) => { checks[k] = ok; console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

/* ── stop board: render → outage → reconnect → recovery ── */
const stopId = JSON.parse(payload('arrivals.json')).data[0].naptanId;
await page.goto('http://127.0.0.1:8901/v2/#/stop/' + stopId, { waitUntil:'load' }); await page.waitForTimeout(3500);
const rows0 = await page.evaluate(() => document.querySelectorAll('#arrBoard > div').length);
F('board renders arrivals (' + rows0 + ' rows)', rows0 > 0);
const next0 = await page.evaluate(() => document.getElementById('nextUpd')?.textContent ?? '');
F('poll aligned to capture clock (' + next0 + ')', +(next0.match(/in (\d+) s/)?.[1] ?? 999) <= 12);
state.failArrivals = true;
await page.waitForTimeout(12000);
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
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} resilience checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
