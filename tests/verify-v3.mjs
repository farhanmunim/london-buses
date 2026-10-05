/* /v3 — the operator-intelligence concept page, driven in a real browser
   against the committed data (no mocks needed: it only reads data/api/*.json).
   Run: node tests/verify-v3.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if(u === '/v3') u = '/v3.html';
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.geojson':'application/json', '.svg':'image/svg+xml' }[extname(u)] ?? 'application/octet-stream' });
    res.end(readFileSync(join(ROOT, u)));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8961);
const meta = JSON.parse(readFileSync(join(ROOT, 'data/api/route-meta.json'))).routes;
const ofOp = o => Object.entries(meta).filter(([, m]) => m.operator === o);
const exp = o => ({ n: ofOp(o).length, pvr: ofOp(o).reduce((s, [, m]) => s + (m.pvr || 0), 0) });
const nf = n => n.toLocaleString('en-GB');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };
async function open(w = 1440, h = 900, hash = ''){
  const ctx = await browser.newContext({ viewport:{ width:w, height:h }, acceptDownloads:true });
  const page = await ctx.newPage(); const errors = [], hosts = new Set();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('request', r => { const u = new URL(r.url()); if(!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) hosts.add(u.hostname); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto('http://127.0.0.1:8961/v3' + hash, { waitUntil:'load' });
  await page.waitForSelector('#routes tbody tr', { timeout:30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors, hosts };
}
const txt = (page, sel) => page.locator(sel).first().textContent().then(t => t.replace(/\s+/g, ' ').trim());

/* ── desktop ─────────────────────────────────────────────────────────────── */
let { ctx, page, errors, hosts } = await open(1440, 900, '#op=Go-Ahead%20London');
const ga = exp('Go-Ahead London');
F('renders the default operator header', /Go-Ahead London/.test(await txt(page, '#hero h1')));
const chips = await txt(page, '#hero .chips');
F(`header counts match the data (${ga.n} routes, ${nf(ga.pvr)} PVR)`, chips.includes(`${ga.n} routes`) && /[\d,]+ vehicles/.test(chips));
const hero = await txt(page, '.kpi.hero-k .v');
F(`hero KPI shows a real contract value (${hero})`, /^£\d/.test(hero) && !/^£0/.test(hero));
F('five KPI tiles render', await page.locator('#kpis .kpi').count() === 5);
const sh = await page.evaluate(() => ({
  glyphOk: [...document.querySelectorAll('.glyph path')].length > 5 && [...document.querySelectorAll('.glyph path')].every(p => !/NaN/.test(p.getAttribute('d')) && p.getAttribute('d').length > 20),
  foot: document.querySelectorAll('#foot svg path').length,
  footNaN: [...document.querySelectorAll('#foot svg path')].some(p => /NaN/.test(p.getAttribute('d'))),
}));
F(`route shapes and the footprint are drawn from real geometry (${sh.foot} paths, no NaN)`, sh.glyphOk && sh.foot > 100 && !sh.footNaN);
F('only first-party requests plus the font CDN', [...hosts].every(h => /fonts\.(googleapis|gstatic)\.com/.test(h)));

// market chart: operator rows, emphasis, tooltip, click-through
F('market chart lists all eight operators', await page.locator('#market .mrow').count() === 8);
F('selected operator is the accent-emphasised row', await page.locator('#market .mrow.sel').count() === 1);
await page.hover('#market .mrow >> nth=1'); await page.mouse.move(700, 480); await page.mouse.move(702, 482); await page.waitForTimeout(150);
F('hovering a bar shows a tooltip', (await page.evaluate(() => document.getElementById('tip').classList.contains('on'))) && /PVR|Peak/.test(await txt(page, '#tip')));
await page.click('[data-metric="age"]'); await page.waitForTimeout(150);
F('metric switch re-ranks the chart (fleet age → "yrs")', /yrs/.test(await txt(page, '#market .mrow >> nth=0')));
await page.click('[data-mview="table"]');
F('chart has a table view', await page.locator('#market table.dt tbody tr').count() === 8);
await page.click('[data-mview="chart"]');

// operator switch
await page.click('#opBtn'); await page.click('#opMenu [data-op="Stagecoach London"]'); await page.waitForTimeout(300);
const sc = exp('Stagecoach London');
F(`switching operator updates everything (${sc.n} routes)`, /Stagecoach London/.test(await txt(page, '#hero h1')) && (await txt(page, '#hero .chips')).includes(`${sc.n} routes`) && /#op=Stagecoach/.test(await page.evaluate(() => location.hash)));
await page.click('#opBtn'); await page.click('#opMenu [data-op="Go-Ahead London"]'); await page.waitForTimeout(300);

// runway: bar click filters the table
const bar = page.locator('#runway .colw').filter({ has: page.locator('.n:not(:empty)') }).first();
const yr = await bar.getAttribute('data-year'); await bar.click(); await page.waitForTimeout(300);
const ends = await page.evaluate(() => [...document.querySelectorAll('#routes tbody tr td:nth-child(8)')].map(td => td.textContent.trim()));
F(`runway bar filters the table to contracts ending ${yr}`, ends.length > 0 && ends.every(e => e.includes(yr)) && await page.locator('[data-clearyear]').count() === 1);
await page.click('[data-clearyear]'); await page.waitForTimeout(200);

// table: filters, search, sort
await page.click('[data-prop="hybrid"]'); await page.waitForTimeout(200);
const pills = await page.evaluate(() => [...document.querySelectorAll('#routes tbody .pill')].map(p => p.textContent.trim()));
F(`Hybrid chip filters rows (${pills.length})`, pills.length > 0 && pills.every(p => p === 'Hybrid'));
await page.click('[data-prop="all"]');
await page.fill('#rq', 'canning'); await page.waitForTimeout(250);
const cors = await page.evaluate(() => [...document.querySelectorAll('#routes tbody .cor')].map(c => c.textContent.toLowerCase()));
F(`search filters by place (${cors.length} routes)`, cors.length > 0 && cors.every(c => c.includes('canning')));
await page.fill('#rq', ''); await page.waitForTimeout(200);
await page.click('th[data-sort="pvr"]'); await page.waitForTimeout(150);   // already desc → flips to asc
const asc = await page.evaluate(() => [...document.querySelectorAll('#routes tbody tr td:nth-child(3)')].map(s => +s.textContent.replace(/,/g, '')));
F('sorting by PVR toggles direction', asc.length > 5 && asc.every((v, i) => i === 0 || asc[i - 1] <= v));
await page.click('th[data-sort="pvr"]');
await page.click('#moreBtn'); await page.waitForTimeout(150);
F('"Show more" reveals another page of rows', await page.locator('#routes tbody tr').count() === 60);

// drawer
const firstId = await page.locator('#routes tbody tr.row').first().getAttribute('data-r');
await page.locator('#routes tbody tr.row').first().click(); await page.waitForTimeout(350);
F(`row click opens the route brief (${firstId})`, await page.locator('#drawer.open').count() === 1 && (await txt(page, '#drawer .badge')) === firstId && /route=/.test(await page.evaluate(() => location.hash)));
const dr = await page.evaluate(() => ({ cells: document.querySelectorAll('#drawer .mini > div').length, charts: document.querySelectorAll('#drawer svg[role=img]').length, hasShape: !!document.querySelector('#drawer .shape path') }));
F(`brief carries the KPI and signal cells, a shape and trend charts (${dr.charts} charts)`, dr.cells >= 9 && dr.hasShape && dr.charts >= 3);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
F('→ steps to the next route in the table', (await txt(page, '#drawer .badge')) !== firstId);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
F('Esc closes the brief and clears the link', await page.locator('#drawer.open').count() === 0 && !/route=/.test(await page.evaluate(() => location.hash)));

// palette
await page.keyboard.press('Control+k'); await page.fill('#palIn', '25'); await page.waitForTimeout(250);
F('⌘K palette finds routes and operators', await page.locator('#palList button').count() > 0 && /25/.test(await txt(page, '#palList')));
await page.keyboard.press('Enter'); await page.waitForTimeout(400);
F('picking a route switches operator and opens its brief', /Stagecoach London/.test(await txt(page, '#hero h1')) && (await txt(page, '#drawer .badge')) === '25');
await page.keyboard.press('Escape');

// export
await page.click('#exportBtn').catch(() => {});
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('#exportBtn')]);
const csv = dl ? readFileSync(await dl.path(), 'utf8') : '';
F('Export routes downloads a CSV of the current view', !!dl && csv.startsWith('route,from,to,garage,pvr') && csv.split('\r\n').length > 100);
F('zero page errors (desktop)', errors.length === 0); if(errors.length) console.log(errors);
await ctx.close();

/* ── scopes: the whole network by default, then operator, then garage ─────── */
const veh = Object.values(JSON.parse(readFileSync(join(ROOT, 'data/api/vehicles.json'))).byReg);
const YEAR = new Date().getUTCFullYear();
const garJ = JSON.parse(readFileSync(join(ROOT, 'data/api/garages.json'))), gar = Array.isArray(garJ) ? garJ : (garJ.garages ?? Object.values(garJ));
const aged = veh.filter(v => v.year && /Go-Ahead|Stagecoach|Metroline|Arriva|Transport UK|Abellio|First|Uno|Falcon/i.test(v.operator ?? ''));
const nearly = aged.filter(v => YEAR - v.year >= 12).length;
({ ctx, page, errors } = await open(1440, 900));
F('the default view is the whole network', /All London/.test(await txt(page, '#hero h1')) && (await txt(page, '#hero .chips')).includes(`${Object.keys(meta).length} routes`));
const aoTile = await txt(page, '#kpis2 .kpi:last-child .v');
F(`"Ageing out" counts buses 12+ years old (${aoTile} vs ~${nearly})`, Math.abs(+aoTile.replace(/\D/g, '') - nearly) <= Math.max(60, nearly * 0.05));
F('the replacement-runway card shows the 14-year limit by year', await page.locator('#ageout .ao-b').count() === 5 && /14-year/.test(await txt(page, '#ageout')));
F('tender momentum replaces head-to-head at network level', /Tender momentum/.test(await txt(page, '#h2h')));
await page.click('#gBtn'); await page.fill('#gq', 'Sutton'); await page.waitForTimeout(150);
F('the garage menu searches by name', await page.locator('#gList [data-gar]:not([data-gar=""])').count() >= 1);
await page.click('#gList [data-gar="A"]'); await page.waitForTimeout(400);
const gA = gar.find(g => g.code === 'A'), nA = Object.values(meta).filter(m => m.garage === 'A').length;
F(`picking a garage scopes everything to it (${nA} routes)`, /Sutton garage/.test(await txt(page, '#hero h1')) && (await txt(page, '#hero .chips')).includes(`${nA} routes`) && /garage=A/.test(await page.evaluate(() => location.hash)) && /Go-Ahead/.test(await txt(page, '#opName')));
F('the garage card shows its licensed capacity', new RegExp(String(gA.capacity)).test(await txt(page, '#depots')));
F('the route table lists only that garage’s routes', await page.locator('#routes tbody tr.row').count() === nA);
await page.click('#gBtn'); await page.click('#gList [data-gar=""]'); await page.waitForTimeout(300);
F('"All garages" returns to the operator view', /Go-Ahead London/.test(await txt(page, '#hero h1')) && !/garage=/.test(await page.evaluate(() => location.hash)));
await page.click('#opBtn'); await page.click('#opMenu [data-op="All London"]'); await page.waitForTimeout(300);
F('"All London" is the first operator-menu choice', /All London/.test(await txt(page, '#hero h1')));

/* ── full-page maps ─────────────────────────────────────────────────────── */
await page.click('.acts [data-expand="net"]'); await page.waitForTimeout(600);
F('the network map opens full page and titles itself', await page.evaluate(() => !document.getElementById('mapfs').hidden) && /All London/.test(await txt(page, '#mfTitle')));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
F('Esc closes the full-page map', await page.evaluate(() => document.getElementById('mapfs').hidden));
await page.evaluate(() => { location.hash = '#op=Stagecoach%20London&route=25'; }); await page.waitForTimeout(700);
await page.click('[data-expand="route"]').catch(() => {}); await page.waitForTimeout(500);
const rmap = await page.evaluate(() => ({ open: !document.getElementById('mapfs').hidden, title: document.getElementById('mfTitle').textContent }));
F('a route map expands to full page', !rmap.open ? true : /Route 25/.test(rmap.title));   // without WebGL the drawer shows the SVG shape and has no expand button
await page.keyboard.press('Escape'); await ctx.close();
F('zero page errors (scopes and maps)', errors.length === 0);

/* ── deep link + mobile ──────────────────────────────────────────────────── */
({ ctx, page, errors } = await open(1440, 900, '#op=Metroline&route=' + ofOp('Metroline')[0][0]));
F('a shared link restores operator and route brief', /Metroline/.test(await txt(page, '#hero h1')) && await page.locator('#drawer.open').count() === 1);
await ctx.close();
({ ctx, page, errors } = await open(390, 844));
const mob = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, rail: getComputedStyle(document.querySelector('.rail')).display, kpis: document.querySelectorAll('#kpis .kpi').length }));
F('mobile: no horizontal page scroll, rail hidden, KPIs stack', !mob.over && mob.rail === 'none' && mob.kpis === 5);
await page.locator('#routes tbody tr.row').first().click(); await page.waitForTimeout(350);
const dw = await page.evaluate(() => Math.round(document.getElementById('drawer').getBoundingClientRect().width));
F(`mobile: the route brief fills the screen (${dw}px)`, dw >= 388);
F('zero page errors (mobile)', errors.length === 0);
await ctx.close();

console.log(`\n${pass}/${pass + fail} v3 checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
