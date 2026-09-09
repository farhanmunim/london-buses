/* End-to-end: stop arrivals board → click a plate → vehicle page shows the
   live-location map. Mocks TfL arrivals + the live-vehicles function. */
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
    res.writeHead(200, { 'content-type': { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8903);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1280,height:900} })).newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: payload('leaflet-heat.js') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
await page.route('**://api.tfl.gov.uk/StopPoint/**', r => {
  const arr = JSON.parse(payload('arrivals.json')).data ?? [];
  arr.forEach((p,i) => { p.expectedArrival = new Date(Date.now() + (60 + i*80)*1000).toISOString(); p.timeToStation = 60 + i*80; });
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=30'}, body: JSON.stringify(arr) });
});
await page.route('**://api.tfl.gov.uk/Line/**', r => r.fulfill({ status:502, body:'nope' }));
await page.route('**/api/live/vehicles*', r => {
  const line = new URL(r.request().url()).searchParams.get('line');
  const v = { feed:'vehicles', live:true, capturedAt:new Date().toISOString(),
    data: line === '214' ? [{ reg:'LA19KAK', lat:51.5539, lng:-0.1461, bearing:120, direction:'1', destination:'Highgate Village', publishedLine:'214' }] : [] };
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*','cache-control':'public, max-age=15'}, body: JSON.stringify(v) });
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|atlas\.farhan\.app/, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };

/* 1. stop board renders with clickable plates */
await page.goto('http://127.0.0.1:8903/#/stop/490008660N', { waitUntil:'load' });
await page.waitForTimeout(3000);
const plates = await page.$$eval('#arrBoard a.plate', as => as.map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
F(`board shows plate links (${plates.length}, first ${plates[0]?.text})`, plates.length >= 4 && plates[0].text === 'LA19KAK');
F(`plate link carries stop+line context (${plates[0]?.href})`, /#\/vehicle\/LA19KAK\?stop=490008660N&line=214/.test(plates[0]?.href ?? ''));

/* 2. click the plate → vehicle page */
await page.click('#arrBoard a.plate');
await page.waitForTimeout(2500);
F('navigated to vehicle page', (await page.evaluate(() => location.hash)).startsWith('#/vehicle/LA19KAK'));
F('plate heading shown', await page.locator('h1 .plate, h1').first().textContent().then(t => t.includes('LA19KAK')));

/* 3. live section appears with the bus on the map */
const secVisible = await page.evaluate(() => { const s = document.getElementById('vLiveSec'); return !!s && !s.hidden; });
F('live-location section visible', secVisible);
const marker = await page.evaluate(() => !!document.querySelector('#map .lb-bus, #map .leaflet-marker-icon'));
F('bus marker drawn on the map', marker);
const note = await page.locator('#vLiveNote').textContent().catch(() => '');
F(`live note shows next update ("${note.trim()}")`, /next update in \d+ s/.test(note));

/* 4. countdown ticks and the poll survives */
await page.waitForTimeout(2500);
const note2 = await page.locator('#vLiveNote').textContent().catch(() => '');
F(`countdown ticks ("${note2.trim()}")`, /next update in \d+ s|updating…/.test(note2) && note2 !== note);

F('zero page errors', errors.length === 0);
if(errors.length) console.log('  errors: ' + errors.join(' | '));
console.log(`\n${pass}/${pass+fail} vehicle-flow checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
