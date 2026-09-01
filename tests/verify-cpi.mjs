/* CPI-CPA page suite — the ONS index + CPA rates page must render from the
   committed dataset with values that match it exactly.
   Run: node tests/verify-cpi.mjs */
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
}).listen(8906);

const data = JSON.parse(readFileSync(join(ROOT, 'data/api/cpi-cpa.json')));
const latest = data.months[data.months.length - 1];

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
await page.route(/cartocdn|openstreetmap\.org|fonts\.|api\.tfl\.gov\.uk|atlas\.farhan\.app/, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

await page.goto('http://127.0.0.1:8906/v2/#/cpi', { waitUntil:'load' }); await page.waitForTimeout(2000);
const r = await page.evaluate(() => ({
  h1: document.querySelector('#main h1')?.textContent ?? '',
  facts: [...document.querySelectorAll('#main .fact')].map(f => f.textContent),
  rows: document.querySelectorAll('#main .cpi-table tbody tr').length,
  firstRow: document.querySelector('#main .cpi-table tbody tr')?.textContent ?? '',
  navOn: document.querySelector('[data-nav="cpi"].on') != null,
  legend: [...document.querySelectorAll('#main .legendrow')].map(l => l.textContent).join(' '),
}));
F('CPI-CPA page renders (' + r.rows + ' rows)', r.h1 === 'CPI-CPA' && r.rows === data.months.length);
F('nav highlights CPI-CPA', r.navOn);
F('KPI tiles show latest CPI ' + latest.cpi, r.facts.some(t => t.includes('CPI index') && t.includes(latest.cpi)));
const p2pPct = (Number(latest.p2p) * 100).toFixed(2) + '%';
const raPct  = (Number(latest.ra) * 100).toFixed(2) + '%';
F('first table row is the latest month with P2P ' + p2pPct + ' / RA ' + raPct,
  r.firstRow.includes(latest.cpi) && r.firstRow.includes(p2pPct) && r.firstRow.includes(raPct));
F('formulas + ONS source stated', /0\.85/.test(r.legend) && /ONS/.test(r.legend));
const nextRel = data.nextRelease ?? '';
F('next ONS release surfaced prominently (' + JSON.stringify(nextRel) + ')',
  !nextRel || (await page.evaluate(nr => document.getElementById('main').textContent.split(nr).length - 1, nextRel)) >= 2);
/* export buttons produce real CSVs */
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.click('#cpiExport'),
]);
const cpiCsv = readFileSync(await dl.path(), 'utf8');
F('CPI export downloads CSV (' + dl.suggestedFilename() + ', ' + cpiCsv.split('\r\n').length + ' rows)',
  dl.suggestedFilename() === 'cpi-cpa.csv' && cpiCsv.includes('month') && cpiCsv.includes(latest.cpi) && cpiCsv.split('\r\n').length === data.months.length + 1);
F('ONS link present', await page.evaluate(() => !!document.querySelector('#main a[href*="ons.gov.uk"]')));

await page.goto('http://127.0.0.1:8906/v2/#/map', { waitUntil:'load' }); await page.waitForTimeout(5000);
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.click('#nmExport'),
]);
const mapCsv = readFileSync(await dl2.path(), 'utf8');
const mapRows = mapCsv.split('\r\n').length - 1;
F('map export downloads every route (' + mapRows + ' rows)',
  dl2.suggestedFilename() === 'london-bus-routes.csv' && mapRows > 600 && mapCsv.includes('pvr') && mapCsv.includes('"88"'));

F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} CPI checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
