/* Tenders page + £/mile chart suite.
   Run: node tests/verify-tenders.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8909);
const tenders = JSON.parse(readFileSync(join(ROOT, 'data/api/tenders.json')));
const total = Object.values(tenders.byId).filter(a => a.awardDate).length;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1280,height:900}, acceptDownloads:true })).newPage();
const FIX = join(ROOT, 'tests/fixtures/');
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX + 'leaflet-heat.js', 'utf8') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX + 'leaflet.js', 'utf8') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: readFileSync(FIX + 'leaflet.css', 'utf8') });
  return r.abort();
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|api\.tfl\.gov\.uk|atlas\.farhan\.app|\/api\/live\//, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

/* tenders page */
await page.goto('http://127.0.0.1:8909/v2/#/tenders', { waitUntil:'load' }); await page.waitForTimeout(2500);
const t = await page.evaluate(() => ({
  count: document.getElementById('tCount')?.textContent ?? '',
  rows: document.querySelectorAll('#tBody tr').length,
  navOn: !!document.querySelector('[data-nav="tenders"].on'),
}));
F('tenders page renders all awards ("' + t.count + '", ' + t.rows + ' rows shown)',
  t.count.includes(total.toLocaleString('en-GB')) && t.rows === 50 && t.navOn);

const k0 = await page.evaluate(() => [...document.querySelectorAll('#tKpis .fact')].map(f => f.textContent.replace(/\s+/g,' ').trim()));
F('KPI tiles render (' + k0.length + '): ' + (k0[0] ?? '').slice(0,40),
  k0.length === 6 && /£\d/.test(k0[0]) && /Median/.test(k0[0]) && k0.some(x => /Incumbent retained/.test(x)) && k0.some(x => /Won by lowest/.test(x)));

await page.selectOption('#top', 'Metroline'); await page.waitForTimeout(400);
const kM = await page.evaluate(() => ({
  kpis: [...document.querySelectorAll('#tKpis .fact')].map(f => f.textContent),
  clearShown: !document.getElementById('topClear').hidden,
}));
F('KPIs recompute on filter (Most awards → Metroline)', kM.kpis.some(x => /Most awards/.test(x) && /Metroline/.test(x)));
await page.click('#topClear'); await page.waitForTimeout(400);
const cleared = await page.evaluate(() => ({
  val: document.getElementById('top').value,
  hidden: document.getElementById('topClear').hidden,
  count: document.getElementById('tCount').textContent,
}));
F('operator clear button works (shown-on-filter, resets to "' + cleared.count.slice(0,12) + '")',
  kM.clearShown && cleared.val === '' && cleared.hidden && !/\(of /.test(cleared.count));

await page.fill('#tq', '24'); await page.waitForTimeout(500);
const q = await page.evaluate(() => ({
  count: document.getElementById('tCount')?.textContent ?? '',
  routes: [...document.querySelectorAll('#tBody tr td:nth-child(2)')].map(td => td.textContent.trim()),
}));
F('route search is exact ("' + q.count + '", routes: ' + [...new Set(q.routes)].slice(0,4).join(' | ') + ')',
  /\(of /.test(q.count) && q.routes.length > 0
  && q.routes.every(r => r.split(/\s+/).some(t => t === '24') || /24/.test(r) === false || r.split(/\s+/).every(t => ['24','N24'].includes(t))));

await page.fill('#tq', ''); await page.waitForTimeout(400);
await page.selectOption('#top', 'Metroline'); await page.waitForTimeout(400);
const op = await page.evaluate(() => [...document.querySelectorAll('#tBody tr td:nth-child(3)')].slice(0,20).map(td => td.childNodes[0]?.textContent ?? td.textContent));
F('operator filter (' + op.length + ' sampled)', op.length > 0 && op.every(o => o === 'Metroline'));

await page.selectOption('#top', ''); await page.waitForTimeout(300);
await page.click('th[data-sort="cpm"]'); await page.waitForTimeout(400);
const cpms = await page.evaluate(() => [...document.querySelectorAll('#tBody tr td:nth-child(4)')].slice(0,5).map(td => td.textContent));
F('sort by £/mile desc (top: ' + cpms[0] + ')', cpms.every(c => c.startsWith('£')) && parseFloat(cpms[0].slice(1)) >= parseFloat(cpms[1].slice(1)));

const [dl] = await Promise.all([ page.waitForEvent('download', { timeout: 8000 }), page.click('#tExport') ]);
const csv = readFileSync(await dl.path(), 'utf8');
F('export view downloads (' + dl.suggestedFilename() + ', ' + (csv.split('\r\n').length-1) + ' rows)',
  dl.suggestedFilename() === 'london-bus-tenders.csv' && csv.includes('cost_per_mile') && csv.split('\r\n').length - 1 === total);

/* programme table */
const pr = await page.evaluate(() => ({
  rows: document.querySelectorAll('#pBody tr').length,
  count: document.getElementById('pCount')?.textContent ?? '',
  page: document.getElementById('pPage')?.textContent ?? '',
  upHighlighted: [...document.querySelectorAll('#pBody tr')].some(tr => tr.getAttribute('style')?.includes('acc-soft')),
}));
F('programme table renders paginated ("' + pr.count.trim() + '", ' + pr.rows + ' rows, ' + pr.page + ')',
  pr.rows === 50 && /1,265 entries/.test(pr.count) && /upcoming/.test(pr.count) && /Page 1 of/.test(pr.page));
await page.click('#pNext'); await page.waitForTimeout(300);
const pr2 = await page.evaluate(() => document.getElementById('pPage')?.textContent ?? '');
F('programme pagination advances (' + pr2 + ')', /Page 2 of/.test(pr2));
await page.fill('#pq', '482'); await page.waitForTimeout(400);
const pr3 = await page.evaluate(() => [...document.querySelectorAll('#pBody tr td:first-child')].map(td => td.textContent.trim()));
F('programme route search exact (' + [...new Set(pr3)].join('|') + ')', pr3.length > 0 && pr3.every(r => r === '482'));
await page.fill('#pq', ''); await page.waitForTimeout(300);

/* awards pagination */
await page.click('#tNext'); await page.waitForTimeout(300);
const tp2 = await page.evaluate(() => document.getElementById('tPage')?.textContent ?? '');
F('awards pagination advances (' + tp2 + ')', /Page 2 of 50/.test(tp2));

/* upcoming-tender flag on route page */
await page.goto('http://127.0.0.1:8909/v2/#/route/482', { waitUntil:'load' }); await page.waitForTimeout(2500);
const flag = await page.evaluate(() => [...document.querySelectorAll('.divn-note')].map(n => n.textContent).find(t => /Coming up for tender/.test(t)) ?? '');
F('route page flags upcoming tender ("' + flag.replace(/\s+/g,' ').slice(0,60) + '")', /Coming up for tender/.test(flag) && /contract starts/.test(flag));

/* route page chart */
await page.goto('http://127.0.0.1:8909/v2/#/route/88', { waitUntil:'load' }); await page.waitForTimeout(3000);
const ch = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('#main .section-h')].find(h => /Cost per mile/.test(h.textContent))?.closest('.section');
  if(!sec) return null;
  const hits = sec.querySelectorAll('.cpm-hit');
  hits[hits.length-1]?.dispatchEvent(new PointerEvent('pointerover', { bubbles:true }));
  const tipEl = sec.querySelector('.cpm-tip');
  return {
    awards: hits.length,
    steps: sec.querySelectorAll('svg line[stroke-width="2"]').length,
    tipShown: tipEl && !tipEl.hidden,
    tip: tipEl?.textContent ?? '',
    legend: sec.textContent,
    beforeContract: [...document.querySelectorAll('#main .section-h')].findIndex(h => /Cost per mile/.test(h.textContent))
      < [...document.querySelectorAll('#main .section-h')].findIndex(h => /Current contract/.test(h.textContent)),
  };
});
F('£/mile line chart renders (' + (ch?.awards ?? 0) + ' awards, ' + (ch?.steps ?? 0) + ' segments)', !!ch && ch.awards >= 2 && ch.steps === ch.awards - 1);
F('chart sits above the award cards', !!ch?.beforeContract);
F('hover shows tooltip with £/date/operator ("' + (ch?.tip ?? '').slice(0,40) + '")', !!ch?.tipShown && /£/.test(ch?.tip ?? '') && /\d{2}\/\d{2}\/\d{4}/.test(ch?.tip ?? ''));
F('legend explains operator-change colouring', /colour change marks an operator change/.test(ch?.legend ?? ''));
F('not-CPI-indexed noted with a link to CPI-CPA', /not indexed against/.test(ch?.legend ?? '') && /CPI-CPA/.test(ch?.legend ?? ''));
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} tender checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
