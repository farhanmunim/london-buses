/* Migration suite — both front-ends must run entirely off the repo's own
   data/api/ faux-API + TfL-direct live endpoints, with zero requests to the
   retired Atlas API and no trace of the scrapped QSI/MPS surfaces.
   Run: node tests/verify-migration.mjs   (serves the repo itself). */
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
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.geojson':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8902);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
const page = await ctx.newPage();
let atlasLeaks = [];
await page.route('**://atlas.farhan.app/**', r => { atlasLeaks.push(r.request().url()); return r.fulfill({ status:410, body:'gone' }); });
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: payload('leaflet-heat.js') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
await page.route('**://api.tfl.gov.uk/Line/**', r => r.fulfill({
  contentType:'application/json', headers:{'access-control-allow-origin':'*'},
  body: JSON.stringify([{ name:'88', lineStatuses:[{ statusSeverity:10, statusSeverityDescription:'Good Service', reason:null }] }]),
}));
await page.route('**://api.tfl.gov.uk/StopPoint/**', r => r.fulfill({
  contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=30'},
  body: JSON.stringify([]),
}));
await page.route('**/api/live/vehicles*', r => r.fulfill({
  contentType:'application/json', headers:{'cache-control':'public, max-age=10'},
  body: JSON.stringify({ feed:'vehicles', live:true, capturedAt:new Date().toISOString(), count:0, data:[] }),
}));
await page.route(/cartocdn|openstreetmap\.org|fonts\./, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
const checks = {}; let pass = 0, fail = 0;
const F = (k, ok) => { checks[k] = ok; console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

/* ── v2: routes list from local data ── */
await page.goto('http://127.0.0.1:8902/v2/#/', { waitUntil:'load' }); await page.waitForTimeout(2500);
const nRoutes = await page.evaluate(() => document.querySelectorAll('#main a.rnum, #main .rrow').length);
F('v2 routes list renders from /data/api (' + nRoutes + ' rows)', nRoutes > 300);

/* ── v2: route detail — facts, tender bids, no reliability sections ── */
await page.goto('http://127.0.0.1:8902/v2/#/route/88', { waitUntil:'load' }); await page.waitForTimeout(3500);
const detail = await page.evaluate(() => ({
  facts: document.querySelectorAll('#dfacts .fact').length,
  text: document.getElementById('main').textContent,
  status: document.getElementById('dstatus')?.textContent.trim() ?? '',
}));
F('v2 route detail facts render (' + detail.facts + ')', detail.facts >= 4);
F('v2 tender history shows bid figures', /Accepted bid|Lowest bid/.test(detail.text));
F('v2 QSI/tracked surfaces gone', !/Tracked reliability|Excess wait time|TfL QSI/.test(detail.text));
F('v2 live status from TfL direct ("' + detail.status.slice(0,20) + '")', /Good Service/.test(detail.status));

/* ── v2: map view draws overview from local geojson ── */
await page.goto('http://127.0.0.1:8902/v2/#/map', { waitUntil:'load' }); await page.waitForTimeout(6000);
const mapOk = await page.evaluate(() => ({
  el: !!document.getElementById('netmap'),
  layers: document.querySelectorAll('#netmap canvas, #netmap path').length,
  count: document.getElementById('nmCount')?.textContent ?? '',
}));
F('v2 network map draws (' + mapOk.layers + ' layers, "' + mapOk.count + '")', mapOk.el && mapOk.layers > 0 && /\d+ routes/.test(mapOk.count));

/* ── v1: home + route card ── */
await page.goto('http://127.0.0.1:8902/', { waitUntil:'load' }); await page.waitForTimeout(4500);
const v1 = await page.evaluate(() => ({
  textLen: document.body.innerText.length,
  hasKpis: !!document.querySelector('.rc-kpis'),
  perfTile: !!document.querySelector('[data-rc-perf]'),
  body: document.body.innerText,
}));
F('v1 loads (' + v1.textLen + ' chars)', v1.textLen > 500);
F('v1 EWT/MPS tiles gone', !v1.perfTile && !/\bEWT\b|\bMPS\b/.test(v1.body));
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
F('no requests reached atlas.farhan.app (' + atlasLeaks.length + ')', atlasLeaks.length === 0);
if(atlasLeaks.length) console.log(atlasLeaks.slice(0,5));

console.log(`\n${pass}/${pass+fail} migration checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
