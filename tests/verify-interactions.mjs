/* Interaction matrix — every user-facing control across every view, driven
   in a real browser with all external feeds mocked. Complements the per-area
   suites: this one asserts each interaction produces its visible effect.
   Run: node tests/verify-interactions.mjs */
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
}).listen(8904);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:1280, height:900 }, acceptDownloads:true });
const page = await ctx.newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: payload('leaflet-heat.js') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: payload('leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: payload('leaflet.css') });
  return r.abort();
});
await page.route('**://api.tfl.gov.uk/StopPoint/**', r => {
  const arr = JSON.parse(payload('arrivals.json')).data ?? [];
  arr.forEach((p,i) => { p.expectedArrival = new Date(Date.now() + (60+i*80)*1000).toISOString(); p.timeToStation = 60+i*80; });
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body: JSON.stringify(arr) });
});
await page.route('**://api.tfl.gov.uk/Line/**', r => r.fulfill({ status:502, body:'down' }));
await page.route('**/api/live/vehicles*', r => {
  const line = new URL(r.request().url()).searchParams.get('line');
  return r.fulfill({ contentType:'application/json', headers:{'access-control-allow-origin':'*'},
    body: JSON.stringify({ feed:'vehicles', live:true, capturedAt:new Date().toISOString(),
      data: [{ reg:'LX09TST', lat:51.51, lng:-0.09, bearing:45, direction:'1', destination:'Test Stop', publishedLine:line }] }) });
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|atlas\.farhan\.app/, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };
const go = async h => { await page.goto('http://127.0.0.1:8904/'+h, { waitUntil:'load' }); await page.waitForTimeout(1600); };
const txt = async sel => (await page.locator(sel).first().textContent().catch(() => '')) ?? '';

/* ── Routes list ── */
await go('#/');
const total = await txt('#countNote');
await page.click('.chip[data-v="electric"]'); await page.waitForTimeout(400);
const filtered = await txt('#countNote');
F(`routes: propulsion chip filters (${total.trim()} → ${filtered.trim()})`, filtered !== total && /match/.test(filtered));
await page.click('.chip[data-v="electric"]'); await page.waitForTimeout(300);
F('routes: chip untoggles back', (await txt('#countNote')) === total);
await page.fill('#q', 'N73'); await page.waitForTimeout(400);
F('routes: search narrows', /1 route/.test(await txt('#countNote')));
await page.click('#qClear'); await page.waitForTimeout(300);
F('routes: clear button restores', (await txt('#countNote')) === total && (await page.inputValue('#q')) === '');
await page.click('.rrow'); await page.waitForTimeout(1500);
F('routes: row click opens route detail', (await page.evaluate(() => location.hash)).startsWith('#/route/'));

/* ── Route detail map controls ── */
await go('#/route/25'); await page.waitForTimeout(1500);
F('route: controls enabled after load', await page.evaluate(() => !document.getElementById('bridgeBtn').disabled));
await page.click('#dirSeg button[data-d="inbound"]'); await page.waitForTimeout(400);
F('route: direction segment switches', await page.evaluate(() => document.querySelector('#dirSeg button[data-d="inbound"]').classList.contains('on')));
await page.click('#stopsBtn'); await page.waitForTimeout(400);
F('route: stops toggle lights', await page.evaluate(() => document.getElementById('stopsBtn').classList.contains('on')));
await page.click('#bridgeBtn'); await page.waitForTimeout(1200);
F('route: bridges toggle draws + notes', /height restriction/.test(await txt('#bridgeNote')));
await page.click('#bridgeBtn'); await page.waitForTimeout(400);
F('route: bridges toggle off removes note', (await page.locator('#bridgeNote').count()) === 0);
await page.click('#incBtn'); await page.waitForTimeout(1200);
F('route: incidents toggle notes', /collision|No recorded/.test(await txt('#incNote')));
await page.click('#closestBtn'); await page.waitForTimeout(800);
F('route: garages toggle lights', await page.evaluate(() => document.getElementById('closestBtn').classList.contains('on')));
await page.click('#liveBtn'); await page.waitForTimeout(1500);
F('route: live buses toggle shows LIVE note', await page.evaluate(() => document.getElementById('busLiveNote').style.display !== 'none'));

/* ── Route detail regs expander ── */
const more = await page.locator('#regMoreBtn').count();
if(more){ await page.click('#regMoreBtn'); F('route: +N more regs expands', await page.evaluate(() => !document.getElementById('regMore')?.hidden)); }
else F('route: regs expander (n/a on this route — skipped as pass)', true);

/* ── Network map ── */
await go('#/map'); await page.waitForTimeout(1800);
await page.fill('#nmq', '25'); await page.waitForTimeout(500);
await page.click('.nm-sug'); await page.waitForTimeout(900);
F('netmap: search suggestion focuses a route', (await page.locator('.netmap-card').count()) >= 1);
await page.click('.netmap-card .close'); await page.waitForTimeout(400);
F('netmap: focus card closes', (await page.locator('.netmap-card').count()) === 0);
await page.click('#nmFilters, button:has-text("Filters")'); await page.waitForTimeout(400);
F('netmap: filters panel opens', await page.evaluate(() => !document.getElementById('nmPop')?.hidden));
const beforeCount = await txt('#nmCount');
const typeChip = page.locator('#nmPop .chip').first();
await typeChip.click(); await page.waitForTimeout(700);
F(`netmap: filter chip changes count (${beforeCount.trim()} → ${(await txt('#nmCount')).trim()})`, (await txt('#nmCount')) !== beforeCount);
await page.click('#nmReset'); await page.waitForTimeout(500);
F('netmap: reset restores', (await txt('#nmCount')) === beforeCount);
await page.click('.nm-colour .seg button:has-text("Type")'); await page.waitForTimeout(600);
F('netmap: colour-by segment switches', await page.evaluate(() => [...document.querySelectorAll('.nm-colour .seg button')].some(b => b.textContent.trim()==='Type' && b.classList.contains('on'))));

/* ── Stops → stop board ── */
await go('#/stops');
await page.fill('#sq', 'angel'); await page.waitForTimeout(600);
F('stops: search matches', /stop/.test(await txt('#sCount')));
await page.click('#slist a, #slist .grow'); await page.waitForTimeout(1800);
F('stops: row opens live board', (await page.evaluate(() => location.hash)).startsWith('#/stop/'));
F('stop: arrivals rows render', (await page.locator('#arrBoard > div').count()) >= 1);

/* ── Operators / garages drill ── */
await go('#/operators');
await page.click('.opcard'); await page.waitForTimeout(1200);
F('operators: card opens detail', (await page.evaluate(() => location.hash)).startsWith('#/operator/'));
await page.click('.grow'); await page.waitForTimeout(1200);
F('operator: garage row opens garage', (await page.evaluate(() => location.hash)).startsWith('#/garage/'));
await page.click('.rchip'); await page.waitForTimeout(1200);
F('garage: route chip opens route', (await page.evaluate(() => location.hash)).startsWith('#/route/'));
await go('#/garages');
const gAll = await txt('#gCount');
await page.fill('#gq', 'catford'); await page.waitForTimeout(400);
F(`garages: search narrows (${gAll.trim()} → ${(await txt('#gCount')).trim()})`, (await txt('#gCount')) !== gAll);

/* ── Tender ── */
await go('#/tender'); await page.waitForTimeout(800);
await page.fill('#tq', '845'); await page.waitForTimeout(500);
F('tender: tranche search filters', /^4 awards/.test((await txt('#tCount')).trim()));
await page.fill('#tq', ''); await page.waitForTimeout(400);
await page.selectOption('#top', { index: 1 }); await page.waitForTimeout(500);
F('tender: operator select filters', /of 2,5/.test(await txt('#tCount')));
await page.click('#topClear'); await page.waitForTimeout(400);
F('tender: operator clear X restores', !/of 2,5/.test(await txt('#tCount')));
await page.click('th[data-sort="cpm"]'); await page.waitForTimeout(400);
F('tender: £/mile sort arrow appears', await page.evaluate(() => document.querySelector('th[data-sort="cpm"]').textContent.includes('↓')));
const p1 = await txt('#tPage');
await page.click('#tNext'); await page.waitForTimeout(400);
F(`tender: pagination advances (${p1.trim()} → ${(await txt('#tPage')).trim()})`, (await txt('#tPage')) !== p1);
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await page.click('#tExport');
F('tender: CSV export downloads', !!(await dl));
await page.click('#tabP'); await page.waitForTimeout(600);
F('tender: programme tab switches', await page.evaluate(() => !document.getElementById('tabProg').hidden));
await page.fill('#pq', '1032'); await page.waitForTimeout(500);
F('programme: tranche search matches', /entr/.test(await txt('#pCount')));

/* ── CPI + About + theme ── */
await go('#/cpi');
const dl2 = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await page.click('text=Export CSV');
F('cpi: CSV export downloads', !!(await dl2));
await go('#/about');
F('about: freshness table populated', (await page.locator('#freshTable tr').count()) >= 7);
const t0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
await page.click('#themeBtn'); await page.waitForTimeout(600);
F('theme toggle flips', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== t0);
await page.click('#themeBtn'); await page.waitForTimeout(400);

F('zero page errors across the whole matrix', errors.length === 0);
if(errors.length) console.log('  errors: ' + [...new Set(errors)].join(' | '));
console.log(`\n${pass}/${pass+fail} interaction checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
