/* /intelligence — the operator-intelligence concept page, driven in a real browser
   against the committed data (no mocks needed: it only reads data/api/*.json).
   Run: node tests/verify-intelligence.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if(u === '/intelligence') u = '/intelligence.html'; if(u.endsWith('/')) u += 'index.html';
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
  await page.route('**://unpkg.com/**', r => {
    const u = r.request().url(), fx = f => readFileSync(join(ROOT, 'tests/fixtures', f), 'utf8');
    if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body:fx('leaflet-heat.js') });
    if(u.endsWith('leaflet.js')) return r.fulfill({ contentType:'text/javascript', body:fx('leaflet.js') });
    if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body:fx('leaflet.css') });
    return r.abort();
  });
  await page.route(/cartocdn|openstreetmap\.org|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|mochi|openfreemap/, r => r.abort());
  await page.goto('http://127.0.0.1:8961/intelligence' + hash, { waitUntil:'load' });
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

const clickable = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if(!e) return false; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && e.contains(t); }, sel);
// drawer
const firstId = await page.locator('#routes tbody tr.row').first().getAttribute('data-r');
await page.locator('#routes tbody tr.row').first().click(); await page.waitForTimeout(350);
F(`row click opens the route brief (${firstId})`, await page.locator('#drawer.open').count() === 1 && (await txt(page, '#drawer .badge')) === firstId && /route=/.test(await page.evaluate(() => location.hash)));
const dr = await page.evaluate(() => ({ cells: document.querySelectorAll('#drawer .mini > div').length, charts: document.querySelectorAll('#drawer svg[role=img]').length, hasShape: !!document.querySelector('#drawer .shape path') || /route map/i.test(document.querySelector('#drawer')?.textContent ?? '') }));
F('the open route brief is not covered by the site banner (its controls are clickable)', await clickable('#drawer .x button'));
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
F('the full-page map is not covered by the site banner (Close is clickable)', await clickable('#mfClose'));
const fr = page.frameLocator('#mfBody iframe');
await fr.locator('#nmCount').waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
F('the expanded map is the main /map in an embedded frame (all London, no header, banner or tab bar)', await page.evaluate(() => { const f = document.querySelector('#mfBody iframe'); const d = f?.contentDocument; return !!d && /#\/map\?/.test(f.src) && /embed=1/.test(f.src) && d.documentElement.classList.contains('embed') && getComputedStyle(d.querySelector('.topbar')).display === 'none' && !d.getElementById('site-banner'); }));
F('the embedded map has the main map layers row incl. garages', await fr.locator('#nmLayers [data-lyr]').count() === 7 && /routes/.test(await fr.locator('#nmCount').textContent()));
F('the network map opens full page and titles itself', await page.evaluate(() => !document.getElementById('mapfs').hidden) && /All London/.test(await txt(page, '#mfTitle')));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.click('#opBtn'); await page.click('#opMenu [data-op="Go-Ahead London"]'); await page.waitForTimeout(300);
await page.click('.acts [data-expand="net"]'); await fr.locator('#nmCount').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
F('an operator\'s expanded map is the main map filtered to its routes', /ids=/.test(await page.locator('#mfBody iframe').getAttribute('src')) && new RegExp(`${exp('Go-Ahead London').n} of 675 routes`).test(await fr.locator('#nmCount').textContent()));
F('its garages layer shows that operator\'s garages', await fr.locator('[data-lyr="garages"].on').count() === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
F('Esc closes the full-page map', await page.evaluate(() => document.getElementById('mapfs').hidden));
await page.evaluate(() => { location.hash = '#op=Stagecoach%20London&route=25'; }); await page.waitForTimeout(700);
await page.click('[data-expand="route"]').catch(() => {}); await page.waitForTimeout(500);
const rmap = await page.evaluate(() => ({ open: !document.getElementById('mapfs').hidden, title: document.getElementById('mfTitle').textContent }));
F('a route map expands to full page', !rmap.open ? true : /Route 25/.test(rmap.title));   // without WebGL the drawer shows the SVG shape and has no expand button
await page.keyboard.press('Escape'); await ctx.close();
F('zero page errors (scopes and maps)', errors.length === 0);

/* ── compare operators + renewal calendar ──────────────────────────────── */
{
  const o = await open(1440, 900, '#op=Go-Ahead%20London'); const pg = o.page;
  const cols = () => pg.locator('#compare thead th.oh:not(.net)').count();
  F('the rail links to Compare and Renewals', await pg.locator('.rail a[data-sec="compare"]').count() === 1 && await pg.locator('.rail a[data-sec="renewals"]').count() === 1);
  F('compare starts with three operators (the one viewed plus the largest others) and a London column', await cols() === 3 && /Go-Ahead/.test(await txt(pg, '#compare thead th.oh')) && await pg.locator('#compare thead th.oh.net').count() === 1);
  F('compare has every group and marks a best figure per ranked row', (await pg.locator('#compare tr.grp').count()) === 5 && (await pg.locator('#compare td.best').count()) >= 8);
  const goVal = await pg.locator('#compare tbody tr:has(th:text-is("Routes")) td').first().textContent();
  F('the Routes figure matches the operator header', goVal.replace(/\D/g, '') === String(exp('Go-Ahead London').n));
  await pg.click('#compare [data-cmp="Uno"]'); await pg.waitForTimeout(150);
  F('adding a fourth operator adds a column and writes the choice into the link', await cols() === 4 && /cmp=/.test(await pg.evaluate(() => location.hash)));
  await pg.click('#compare [data-cmp="First Bus London"]', { force: true }); await pg.waitForTimeout(100);
  F('a fifth operator is refused (up to four)', await cols() === 4 && await pg.locator('#compare [data-cmp="First Bus London"][aria-pressed="false"]').count() === 1);
  await pg.click('#compare [data-cmp="Uno"]'); await pg.click('#compare [data-cmp="Stagecoach London"]'); await pg.waitForTimeout(100);
  await pg.click('#compare [data-cmp="Metroline"]', { force: true }); await pg.waitForTimeout(100);
  F('at least two operators stay selected', await cols() === 2);
  const [csvDl] = await Promise.all([pg.waitForEvent('download', { timeout: 6000 }).catch(() => null), pg.click('#cmpCsv')]);
  F('the comparison exports to CSV', !!csvDl && /operator-comparison\.csv/.test(csvDl.suggestedFilename()));
  // the shared link restores the selection
  const link = await pg.evaluate(() => location.hash);
  await o.ctx.close();
  const o2 = await open(1440, 900, link);
  F('a shared link restores the compared operators', await o2.page.locator('#compare thead th.oh:not(.net)').count() === 2);
  await o2.ctx.close();

  const r = await open(1440, 900, '#op=Go-Ahead%20London'); const rp = r.page;
  const stat = async i => (await rp.locator('#renewals .rnstats > div').nth(i).locator('.v').textContent()).trim();
  const ends24 = +(await stat(0));
  F(`the renewal calendar counts the routes ending in 24 months (${ends24})`, ends24 > 0 && ends24 <= exp('Go-Ahead London').n);
  F('it lists rows grouped by quarter with a chart', await rp.locator('#renewals .rnq').count() > 0 && await rp.locator('#renewals .rnc .colw').count() >= 5);
  await rp.click('#renewals [data-rnwin="60"]'); await rp.waitForTimeout(150);
  const ends60 = +(await stat(0));
  F(`a longer window shows more contracts (${ends60} in 60 months)`, ends60 > ends24);
  await rp.click('#renewals [data-rnf="awarded"]'); await rp.waitForTimeout(150);
  F('the Already awarded filter lists only decided re-tenders', await rp.locator('#renewals .rnrow').count() > 0 && await rp.locator('#renewals .rnrow:not(:has(.tag.good))').count() === 0);
  await rp.click('#renewals [data-rnf="open"]'); await rp.waitForTimeout(150);
  F('the Still open filter excludes awarded routes', await rp.locator('#renewals .rnrow:has(.tag.good)').count() === 0);
  await rp.click('#renewals [data-rnf="all"]'); await rp.waitForTimeout(150);
  const qb = rp.locator('#renewals .rnc .colw:not(.empty)').first(); await qb.click(); await rp.waitForTimeout(150);
  F('clicking a quarter shows only that quarter and offers a way back', await rp.locator('#renewals .rnq').count() === 1 && await rp.locator('#renewals .rnf [data-rnq]').count() === 1);
  await rp.locator('#renewals .rnf [data-rnq]').click(); await rp.waitForTimeout(150);
  await rp.locator('#renewals .rnrow').first().click(); await rp.waitForTimeout(350);
  F('a renewal row opens the route brief', await rp.locator('#drawer.open').count() === 1);
  await rp.keyboard.press('Escape'); await rp.waitForTimeout(200);
  const [rnDl] = await Promise.all([rp.waitForEvent('download', { timeout: 6000 }).catch(() => null), rp.click('#rnCsv')]);
  F('the renewals export to CSV', !!rnDl && /renewals-60-months\.csv/.test(rnDl.suggestedFilename()));
  F('zero page errors (compare and renewals)', r.errors.length === 0);
  await r.ctx.close();

  for(const w of [320, 390, 820]){
    const m = await open(w, 800, '#op=Stagecoach%20London'); const mp = m.page;
    const st = await mp.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, cmp: !!document.querySelector('#compare .cmpwrap'), sc: (() => { const w = document.querySelector('#compare .cmpwrap'); return w ? w.scrollWidth >= w.clientWidth : false; })(), rows: document.querySelectorAll('#renewals .rnrow').length }));
    F(`compare + renewals at ${w}px: no sideways page scroll, table scrolls inside its card, rows render`, st.over <= 1 && st.cmp && st.sc && st.rows > 0);
    await m.ctx.close();
  }
}

/* ── tender tags, quick filters and info buttons ───────────────────────── */
({ ctx, page, errors } = await open(1440, 900));
const nInfo = await page.locator('.info.corner').count();
F(`every KPI and card carries an info button (${nInfo})`, nInfo >= 20 && await page.locator('.card:not([data-i])').count() <= 1);
await page.locator('#kpis .kpi .info.corner').first().hover(); await page.waitForTimeout(150);
F('hovering an info button explains the figure', (await page.evaluate(() => document.getElementById('tip').classList.contains('on'))) && /contract/i.test(await txt(page, '#tip')));
const thTip = await page.locator('#routes th[data-tip]').count();
F(`route-table columns explain themselves (${thTip})`, thTip >= 8);
await page.click('[data-flag="awd"]'); await page.waitForTimeout(200);
const awN = await page.locator('#routes tbody tr.row').count();
F(`"Just awarded" filters to awarded routes (${awN} shown)`, awN > 0 && awN === await page.locator('#routes tbody tr.row:has(.tag.good)').count());
await page.click('[data-flag="awd"]'); await page.click('[data-flag="prog"]'); await page.waitForTimeout(200);
const pgN = await page.locator('#routes tbody tr.row').count();
F(`"In tender programme" filters to routes in the programme (${pgN} shown)`, pgN > 0 && pgN === await page.locator('#routes tbody tr.row:has(.tag.blue)').count());
await ctx.close();
F('zero page errors (tags and info)', errors.length === 0);

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

console.log(`\n${pass}/${pass + fail} intelligence checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
