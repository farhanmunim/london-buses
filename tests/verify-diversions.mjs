/* Diversions & mileage page.
   Run: node tests/verify-diversions.mjs */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ try{ res.writeHead(404); }catch{} res.end('nf'); }
}).listen(8913);
const hist = JSON.parse(readFileSync(join(ROOT, 'data/api/diversion-history.json')));
const total = hist.entries.length;
const perfExists = existsSync(join(ROOT, 'data/api/route-performance.json'));
const schedExists = existsSync(join(ROOT, 'data/api/scheduled-mileage.json'));

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
await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|\/api\/live\//, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

/* desktop More dropdown at 1280px: visible, opens under the topbar, holds
   the sheet pages, and routes to #/diversions */
await page.goto('http://127.0.0.1:8913/#/', { waitUntil:'load' }); await page.waitForTimeout(1500);
const moreVisible = await page.evaluate(() => {
  const b = document.getElementById('moreBtn');
  return !!b && b.offsetWidth > 0 && getComputedStyle(b).display !== 'none';
});
await page.click('#moreBtn'); await page.waitForTimeout(250);
const dd = await page.evaluate(() => ({
  open: !document.getElementById('moreSheet').hidden,
  links: [...document.querySelectorAll('#moreSheet a')].map(a => a.textContent.trim()),
  inline: [...document.querySelectorAll('.nav-desktop a')].map(a => a.textContent.trim()),
  navLink: document.querySelector('#moreSheet a[data-nav="diversions"]')?.getAttribute('href') ?? '',
  belowBar: document.getElementById('moreSheet').getBoundingClientRect().top >=
    document.querySelector('.topbar').getBoundingClientRect().bottom - 1,
  onscreen: (r => r.left >= 0 && r.right <= 1281)(document.getElementById('moreSheet').getBoundingClientRect()),
}));
F('desktop More dropdown opens with ' + dd.links.join('/') + ' (inline: ' + dd.inline.join('/') + ')',
  moreVisible && dd.open && dd.belowBar && dd.onscreen
  && dd.links.join() === 'Garages,Stops,Diversions,Mileage,CPI-CPA,About'
  && dd.inline.join() === 'Map,Routes,Operators,Tender');
await page.click('#moreSheet a[data-nav="diversions"]'); await page.waitForTimeout(2000);
const nav = await page.evaluate(() => ({
  hash: location.hash,
  closed: document.getElementById('moreSheet').hidden,
  navOn: !!document.querySelector('[data-nav="diversions"].on'),
  moreOn: document.getElementById('moreBtn').classList.contains('on'),
  h1: document.querySelector('#main h1')?.textContent ?? '',
  noPills: !document.getElementById('dTabH') && !document.getElementById('dTabM'),
  mileageLink: !!document.querySelector('#main a[href="#/mileage"]'),
}));
F('dropdown item routes to the page and closes it (' + dd.navLink + ' → ' + nav.hash + ', "' + nav.h1 + '")',
  dd.navLink === '#/diversions' && nav.hash === '#/diversions' && nav.closed && nav.navOn && nav.moreOn
  && /Diversions/.test(nav.h1) && nav.noPills && nav.mileageLink);

/* history table renders rows + count + snapshot note */
const h = await page.evaluate(() => ({
  count: document.getElementById('dCount')?.textContent ?? '',
  rows: document.querySelectorAll('#dBody tr').length,
  page: document.getElementById('dPage')?.textContent ?? '',
  note: document.getElementById('dhead')?.textContent ?? '',
}));
F('history table renders rows and count ("' + h.count + '", ' + h.rows + ' rows, ' + h.page + ')',
  h.count.includes(total.toLocaleString('en-GB')) && h.rows === Math.min(20, total)
  && new RegExp('Page 1 of ' + Math.ceil(total / 20)).test(h.page));
F('snapshot-provenance note shown', /History accumulated from TfL status snapshots since/.test(h.note)
  && /TfL publishes no historical diversion feed/.test(h.note));

/* type filter narrows to only that badge */
await page.selectOption('#dty', 'PlannedWork'); await page.waitForTimeout(400);
const ty = await page.evaluate(() => ({
  badges: [...document.querySelectorAll('#dBody tr td:nth-child(2)')].map(td => td.textContent.trim()),
  count: document.getElementById('dCount')?.textContent ?? '',
}));
const tyTotal = hist.entries.filter(e => e.category === 'PlannedWork').length;
F('type filter narrows to Planned only (' + ty.badges.length + ' rows, "' + ty.count + '")',
  ty.badges.length > 0 && ty.badges.every(b => b === 'Planned') && ty.count.includes(tyTotal.toLocaleString('en-GB')));
await page.selectOption('#dty', ''); await page.waitForTimeout(300);

/* active-only narrows */
const actTotal = hist.entries.filter(e => e.active).length;
await page.check('#dact'); await page.waitForTimeout(400);
const act = await page.evaluate(() => ({
  ticks: [...document.querySelectorAll('#dBody tr td:nth-child(7)')].map(td => td.textContent.trim()),
  count: document.getElementById('dCount')?.textContent ?? '',
}));
F('active-only narrows (' + act.ticks.length + ' rows, "' + act.count + '")',
  actTotal < total && act.count.includes(actTotal.toLocaleString('en-GB')) && act.ticks.length > 0 && act.ticks.every(t => t === '✓'));
await page.uncheck('#dact'); await page.waitForTimeout(300);

/* date filter — pick a real day from the data that only some entries carry */
const dayCounts = {};
for(const e of hist.entries) for(const d of e.days ?? []) dayCounts[d] = (dayCounts[d] ?? 0) + 1;
const day = Object.keys(dayCounts).sort().find(d => dayCounts[d] > 0 && dayCounts[d] < total) ?? Object.keys(dayCounts)[0];
await page.fill('#dday', day); await page.waitForTimeout(400);
const df = await page.evaluate(() => ({
  count: document.getElementById('dCount')?.textContent ?? '',
  dayLists: [...document.querySelectorAll('#dBody tr td:nth-child(6)')].map(td => td.getAttribute('title') ?? ''),
}));
F('date filter narrows to ' + day + ' (' + dayCounts[day] + ' expected, "' + df.count + '") and every visible row includes it',
  dayCounts[day] < total && df.count.includes(dayCounts[day].toLocaleString('en-GB'))
  && df.dayLists.length > 0 && df.dayLists.every(t => t.split(', ').includes(day)));

/* CSV export matches the filtered view (date filter still applied) */
const [dl] = await Promise.all([ page.waitForEvent('download', { timeout: 8000 }), page.click('#dExport') ]);
const csv = readFileSync(await dl.path(), 'utf8');
F('CSV export downloads the filtered view (' + dl.suggestedFilename() + ', ' + (csv.split('\r\n').length - 1) + ' rows)',
  dl.suggestedFilename() === 'london-bus-diversions.csv' && csv.includes('first_seen')
  && csv.split('\r\n').length - 1 === dayCounts[day]);
await page.fill('#dday', ''); await page.waitForTimeout(300);

/* pagination advances */
await page.click('#dNext'); await page.waitForTimeout(300);
const p2 = await page.evaluate(() => document.getElementById('dPage')?.textContent ?? '');
F('history pagination advances (' + p2 + ')', /Page 2 of \d+/.test(p2));

/* #/mileage is its own page — history table gone, mileage table (or the
   still-building note) present, More lights, cross-link back to diversions */
await page.goto('http://127.0.0.1:8913/#/mileage', { waitUntil:'load' }); await page.waitForTimeout(2500);
const m = await page.evaluate(() => ({
  hash: location.hash,
  h1: document.querySelector('#main h1')?.textContent ?? '',
  title: document.title,
  histGone: !document.getElementById('dBody') && !document.getElementById('dTabH') && !document.getElementById('dTabM'),
  navOn: !!document.querySelector('[data-nav="mileage"].on'),
  moreOn: document.getElementById('moreBtn').classList.contains('on'),
  divLink: !!document.querySelector('#main a[href="#/diversions"]'),
  rows: document.querySelectorAll('#mBody tr').length,
  building: /still building/.test(document.querySelector('#mWrap .empty')?.textContent ?? ''),
  firstRow: document.querySelector('#mBody tr')?.textContent?.replace(/\s+/g, ' ') ?? '',
}));
F('#/mileage page shows ' + (perfExists ? 'data rows (' + m.rows + ', first: "' + m.firstRow.slice(0, 60) + '")' : 'the still-building note'),
  m.hash === '#/mileage' && m.h1 === 'Mileage' && /^Mileage · /.test(m.title)
  && m.histGone && m.navOn && m.moreOn && m.divLink
  && (perfExists ? (m.rows > 0 && !m.building && /%/.test(m.firstRow)) : m.building));
if(perfExists){
  const est = await page.evaluate(() => [...document.querySelectorAll('#mBody tr td:nth-child(6)')].map(td => td.textContent.trim()));
  F('est. scheduled km column is honest when scheduled-mileage.json ' + (schedExists ? 'exists (est.-labelled values)' : 'is absent (em-dashes)'),
    est.length > 0 && (schedExists ? est.some(v => /est\./.test(v)) : est.every(v => v === '—')));
  const [mdl] = await Promise.all([ page.waitForEvent('download', { timeout: 8000 }), page.click('#mExport') ]);
  const mcsv = readFileSync(await mdl.path(), 'utf8');
  F('mileage CSV exports (' + mdl.suggestedFilename() + ', ' + (mcsv.split('\r\n').length - 1) + ' rows)',
    mdl.suggestedFilename() === 'london-bus-mileage.csv' && mcsv.includes('est_lost_km') && mcsv.split('\r\n').length - 1 > 0);
}

/* legacy deep link redirects to the new page */
await page.goto('http://127.0.0.1:8913/#/', { waitUntil:'load' }); await page.waitForTimeout(800);
await page.goto('http://127.0.0.1:8913/#/diversions/mileage', { waitUntil:'load' }); await page.waitForTimeout(2500);
const deep = await page.evaluate(() => ({
  hash: location.hash,
  h1: document.querySelector('#main h1')?.textContent ?? '',
  mileageShown: !!document.getElementById('mWrap'),
  histGone: !document.getElementById('dBody'),
}));
F('#/diversions/mileage redirects to #/mileage (' + deep.hash + ', "' + deep.h1 + '")',
  deep.hash === '#/mileage' && deep.h1 === 'Mileage' && deep.mileageShown && deep.histGone);

/* redirected page renders Operated % values + the below-standard filter narrows */
if(perfExists){
  const mv = await page.evaluate(() => ({
    ops: [...document.querySelectorAll('#mBody tr td:nth-child(3)')].map(td => td.textContent.trim()),
    count: document.getElementById('mCount')?.textContent ?? '',
  }));
  const allN = parseInt((mv.count.match(/([\d,]+) rows?/)?.[1] ?? '0').replace(/,/g, ''), 10);
  F('redirected mileage page renders Operated % values ("' + mv.count.trim() + '", first: ' + mv.ops[0] + ')',
    mv.ops.length > 0 && mv.ops.some(v => /^\d+(\.\d+)?%$/.test(v)) && allN >= mv.ops.length);
  await page.check('#mbelow'); await page.waitForTimeout(400);
  const bl = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#mBody tr')].map(tr => ({
      op: tr.children[2]?.textContent.trim() ?? '', min: tr.children[3]?.textContent.trim() ?? '' })),
    count: document.getElementById('mCount')?.textContent ?? '',
  }));
  const belowN = parseInt((bl.count.match(/([\d,]+) rows?/)?.[1] ?? '0').replace(/,/g, ''), 10);
  F('below-standard filter narrows (' + allN + ' → ' + belowN + ') and every row is below its min std',
    belowN > 0 && belowN < allN && bl.rows.length > 0
    && bl.rows.every(r => parseFloat(r.op) < parseFloat(r.min)));
  await page.uncheck('#mbelow'); await page.waitForTimeout(300);
}

F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0, 4));
console.log(`\n${pass}/${pass+fail} diversion checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
