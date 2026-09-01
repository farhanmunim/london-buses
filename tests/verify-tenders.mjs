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
  t.count.includes(total.toLocaleString('en-GB')) && t.rows === 300 && t.navOn);

await page.fill('#tq', '88'); await page.waitForTimeout(500);
const q = await page.evaluate(() => ({
  count: document.getElementById('tCount')?.textContent ?? '',
  firstRoute: document.querySelector('#tBody tr td:nth-child(2)')?.textContent ?? '',
}));
F('search filters ("' + q.count + '", first route "' + q.firstRoute.trim() + '")',
  /\(of /.test(q.count) && /88/.test(q.firstRoute));

await page.fill('#tq', ''); await page.waitForTimeout(400);
await page.selectOption('#top', 'Metroline'); await page.waitForTimeout(400);
const op = await page.evaluate(() => [...document.querySelectorAll('#tBody tr td:nth-child(3)')].slice(0,20).map(td => td.textContent));
F('operator filter (' + op.length + ' sampled)', op.length > 0 && op.every(o => o === 'Metroline'));

await page.selectOption('#top', ''); await page.waitForTimeout(300);
await page.click('th[data-sort="cpm"]'); await page.waitForTimeout(400);
const cpms = await page.evaluate(() => [...document.querySelectorAll('#tBody tr td:nth-child(4)')].slice(0,5).map(td => td.textContent));
F('sort by £/mile desc (top: ' + cpms[0] + ')', cpms.every(c => c.startsWith('£')) && parseFloat(cpms[0].slice(1)) >= parseFloat(cpms[1].slice(1)));

const [dl] = await Promise.all([ page.waitForEvent('download', { timeout: 8000 }), page.click('#tExport') ]);
const csv = readFileSync(await dl.path(), 'utf8');
F('export view downloads (' + dl.suggestedFilename() + ', ' + (csv.split('\r\n').length-1) + ' rows)',
  dl.suggestedFilename() === 'london-bus-tenders.csv' && csv.includes('cost_per_mile') && csv.split('\r\n').length - 1 === total);

/* route page chart */
await page.goto('http://127.0.0.1:8909/v2/#/route/88', { waitUntil:'load' }); await page.waitForTimeout(3000);
const ch = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('#main .section-h')].find(h => /Cost per mile/.test(h.textContent))?.closest('.section');
  if(!sec) return null;
  return {
    dots: sec.querySelectorAll('svg circle').length,
    segs: sec.querySelectorAll('svg line[stroke-width="2.5"]').length,
    tip: sec.querySelector('svg circle title')?.textContent ?? '',
    legend: sec.textContent,
    beforeContract: [...document.querySelectorAll('#main .section-h')].findIndex(h => /Cost per mile/.test(h.textContent))
      < [...document.querySelectorAll('#main .section-h')].findIndex(h => /Current contract/.test(h.textContent)),
  };
});
F('£/mile chart renders (' + (ch?.dots ?? 0) + ' awards, ' + (ch?.segs ?? 0) + ' segments)', !!ch && ch.dots >= 2 && ch.segs === ch.dots - 1);
F('chart sits above the award cards', !!ch?.beforeContract);
F('point tooltip carries date/operator/£ ("' + (ch?.tip ?? '').split('\n')[0] + '")', /£/.test(ch?.tip ?? '') && /—/.test(ch?.tip ?? ''));
F('legend explains operator change', /operator change/.test(ch?.legend ?? ''));
F('not CPI-indexed noted', /not CPI-indexed/.test(ch?.legend ?? ''));
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} tender checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
