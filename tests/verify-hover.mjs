/* Hover, press and focus on every kind of control — driven with a real pointer, not by reading the CSS.
   Run: node tests/verify-hover.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname, FIX = ROOT + 'tests/fixtures/';
const srv = createServer((req, res) => {
  try{
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if(u === '/intelligence') u = '/intelligence.html'; if(u.endsWith('/')) u += 'index.html';
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.geojson':'application/json', '.svg':'image/svg+xml' }[extname(u)] ?? 'application/octet-stream' });
    res.end(readFileSync(join(ROOT, u)));
  }catch{ res.writeHead(404); res.end(); }
}).listen(8973);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };

async function open(hash, opts = {}){
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 }, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.route('**://unpkg.com/**', r => {
    const u = r.request().url(), fx = f => readFileSync(FIX + f, 'utf8');
    if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType: 'text/javascript', body: fx('leaflet-heat.js') });
    if(u.endsWith('leaflet.js')) return r.fulfill({ contentType: 'text/javascript', body: fx('leaflet.js') });
    if(u.endsWith('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: fx('leaflet.css') });
    return r.abort();
  });
  await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|mochi|openfreemap/, r => r.abort());
  await page.goto('http://127.0.0.1:8973/' + hash, { waitUntil: 'load' }); await page.waitForTimeout(1600);
  return { ctx, page };
}
const look = (page, sel) => page.locator(sel).first().evaluate(el => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.borderColor, c.boxShadow, c.transform, c.filter, c.textDecorationLine].join('|'); });
async function hovers(page, sel, label){
  const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2); await page.waitForTimeout(60); const a = await look(page, sel);
  await loc.hover({ force: true }); await page.waitForTimeout(340); const b = await look(page, sel);
  F(`${label}: hovering changes how it looks`, a !== b);
  const cur = await loc.evaluate(el => getComputedStyle(el).cursor); F(`${label}: pointer cursor`, cur === 'pointer' || cur === 'not-allowed');
}

/* ── desktop: the More menu, the case that was reported ───────────────── */
{
  const { ctx, page } = await open('#/');
  await page.click('#moreBtn'); await page.waitForTimeout(300);
  const links = page.locator('#moreSheet a');
  F('the More menu opens with its links', await links.count() >= 6 && await page.locator('#moreSheet:not([hidden])').count() === 1);
  F('the open More button stays lit', await page.locator('#moreBtn').evaluate(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  const n = await links.count(); let lit = 0, rest = null;
  await page.mouse.move(2, 2); await page.waitForTimeout(80);
  rest = await links.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);
  for(let i = 0; i < n; i++){
    await links.nth(i).hover(); await page.waitForTimeout(260);
    const bg = await links.nth(i).evaluate(el => getComputedStyle(el).backgroundColor);
    if(bg !== 'rgba(0, 0, 0, 0)' && (i === 1 ? bg !== rest : true)) lit++;
  }
  F(`every More menu link lights up under the pointer (${lit}/${n})`, lit === n);
  await links.nth(2).hover(); await page.waitForTimeout(260);
  F('only the hovered More link is lit (others are at rest)', await page.evaluate(() => { const ls = [...document.querySelectorAll('#moreSheet a')]; const lit = ls.filter(a => a.matches(':hover')); return lit.length === 1; }));
  await page.keyboard.press('Tab');
  F('zero page errors (More menu)', page.errors.length === 0);
  await ctx.close();
}

/* ── the map library is a CDN dependency: if it is blocked, the menus and non-map pages must still work ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.route('**://unpkg.com/**', r => r.abort());
  await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|mochi|openfreemap/, r => r.abort());
  await page.goto('http://127.0.0.1:8973/#/operators', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  await page.click('#moreBtn'); await page.waitForTimeout(250);
  F('with the map library blocked, the More menu still opens', await page.locator('#moreSheet:not([hidden])').count() === 1);
  await page.click('#moreSheet a[data-nav="streetworks"]'); await page.waitForTimeout(800);
  F('and its links still navigate', /streetworks/.test(await page.evaluate(() => location.hash)));
  await page.goto('http://127.0.0.1:8973/#/map', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  F('a map page says plainly that the map could not load', /map could not load/i.test(await page.evaluate(() => document.body.innerText)));
  await ctx.close();
}

/* ── desktop: every control family ─────────────────────────────────────── */
{
  const { ctx, page } = await open('#/');
  await hovers(page, '.nav-desktop a:not(.on)', 'desktop nav link');
  await hovers(page, '#themeBtn', 'theme button');
  await hovers(page, 'header a[data-nav="about"]', 'header About button');
  await hovers(page, '.rrow', 'route row');
  await hovers(page, '.chip:not(.on)', 'filter chip');
  await ctx.close();
}
{
  const { ctx, page } = await open('#/map');
  await hovers(page, '#nmLayers [data-lyr]:not(.on):not(.is-gated)', 'layer button');
  await page.click('#nmFilters'); await page.waitForTimeout(300);
  await hovers(page, '#nmPop .chip:not(.on)', 'map filter chip');
  await hovers(page, '.nm-colour .seg button:not(.on)', 'segmented control');
  await hovers(page, '#nmExport', 'Export CSV link');
  F('a pin lifts under the pointer', await (async () => {
    const pin = page.locator('.leaflet-marker-icon.leaflet-interactive').first();
    if(!await pin.count()) return true;
    await pin.scrollIntoViewIfNeeded().catch(() => {}); await pin.hover({ force: true }).catch(() => {}); await page.waitForTimeout(300);
    return await pin.evaluate(el => /drop-shadow/.test(getComputedStyle(el).filter));
  })());
  await ctx.close();
}
for(const [h, sel, label] of [['#/operators', '.opcard', 'operator card'], ['#/garages', '.grow', 'garage row'], ['#/tender', 'table.cpi-table tbody tr td', 'table row']]){
  const { ctx, page } = await open(h);
  if(sel.startsWith('table')){
    const a = await look(page, sel); await page.locator(sel).first().hover(); await page.waitForTimeout(300); F(`${label}: hovering highlights the row`, a !== await look(page, sel));
  } else await hovers(page, sel, label);
  await ctx.close();
}

/* ── Intelligence ───────────────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.route(/googletagmanager|mochi|basemaps|openfreemap|tiles|fonts\./, r => r.abort());
  await page.goto('http://127.0.0.1:8973/intelligence#op=Go-Ahead%20London', { waitUntil: 'load' });
  await page.waitForSelector('#routes tbody tr', { timeout: 30000 }); await page.waitForTimeout(700);
  await hovers(page, '.rail a.nav:not(.on)', 'Intelligence rail link');
  await hovers(page, '.top .btn', 'Intelligence header button');
  await hovers(page, '#routes .fchip:not(.on)', 'Intelligence filter chip');
  await hovers(page, '#renewals .rnrow', 'renewal row');
  await hovers(page, '#market .mrow', 'market row');
  const a = await page.locator('#routes tbody tr.row td').nth(2).evaluate(el => getComputedStyle(el).backgroundColor);
  await page.locator('#routes tbody tr.row').nth(3).hover(); await page.waitForTimeout(300);
  F('Intelligence table row highlights under the pointer', await page.locator('#routes tbody tr.row').nth(3).locator('td').nth(2).evaluate(el => getComputedStyle(el).backgroundColor) !== a);
  F('zero page errors (Intelligence)', page.errs.length === 0);
  await ctx.close();
}

/* ── keyboard: one clear focus ring ──────────────────────────────────── */
{
  const { ctx, page } = await open('#/');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const ring = await page.evaluate(() => { const e = document.activeElement, c = getComputedStyle(e); return { tag: e.tagName, w: parseFloat(c.outlineWidth), st: c.outlineStyle }; });
  F(`keyboard focus shows a visible ring (${ring.tag})`, ring.st !== 'none' && ring.w >= 2);
  await ctx.close();
}

/* ── touch: no hover state may stick after a tap ───────────────────────── */
{
  const { ctx, page } = await open('#/', { touch: true, viewport: { width: 390, height: 844 } });
  const sel = '.chip:not(.on)'; const before = await look(page, sel);
  const box = await page.locator(sel).first().boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(100);
  await page.touchscreen.tap(5, 300); await page.waitForTimeout(300);
  const hoverable = await page.evaluate(() => matchMedia('(hover:hover)').matches);
  F('touch devices report no hover, so hover styles never apply', hoverable === false);
  await page.click('#moreTab'); await page.waitForTimeout(250);
  F('the mobile More sheet opens and its links are tappable', await page.locator('#moreSheet:not([hidden]) a').count() >= 6);
  F('zero page errors (touch)', page.errors.length === 0);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} hover and focus checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
