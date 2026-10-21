/* A new operator (Go Bus) must appear everywhere without any code listing it — first as an incoming operator
   (awards only), then, once the route data shows it running routes, as a normal operator with its own colour,
   garage and routes. Run: node tests/verify-new-operator.mjs */
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
}).listen(8979);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k); ok ? pass++ : fail++; };
const GO = ['624', '625', '658'];

async function open(hash, { running = false, viewport = { width: 1280, height: 900 } } = {}){
  const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.route('**://unpkg.com/**', r => {
    const u = r.request().url(), fx = f => readFileSync(FIX + f, 'utf8');
    if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType: 'text/javascript', body: fx('leaflet-heat.js') });
    if(u.endsWith('leaflet.js')) return r.fulfill({ contentType: 'text/javascript', body: fx('leaflet.js') });
    if(u.endsWith('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: fx('leaflet.css') });
    return r.abort();
  });
  await page.route(/cartocdn|openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|atlas\.farhan\.app|mochi|openfreemap|basemaps|tiles/, r => r.abort());
  if(running){
    // the day the route data shows Go Bus running the three routes from its own garage
    await page.route('**/data/api/route-meta.json', async r => { const j = await (await r.fetch()).json(); for(const id of GO) Object.assign(j.routes[id], { operator:'Go Bus', company:'Go Bus Ltd', garage:'GBX', garageName:'Go Bus Depot' }); r.fulfill({ json: j }); });
    await page.route('**/data/api/garages.json', async r => { const j = await (await r.fetch()).json();
      for(const g of j.garages) g.routes = (g.routes ?? []).filter(x => !GO.includes(x));
      j.garages.push({ code:'GBX', name:'Go Bus Depot', operator:'Go Bus', company:'Go Bus Ltd', postcode:'SE10 0NU', postcodeSource:'garage', lat:51.49, lng:0.01, pvr:6, capacity:12, routes:GO });
      r.fulfill({ json: j }); });
  }
  await page.goto('http://127.0.0.1:8979/' + hash, { waitUntil: 'load' }); await page.waitForTimeout(2200);
  return { ctx, page };
}
const text = (page, sel = '#main') => page.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim());

/* ── awards only: Go Bus is incoming ──────────────────────────────────── */
{
  let { ctx, page } = await open('#/operators');
  const t = await text(page);
  F('Operators page lists Go Bus under New and incoming, with its awarded routes', /new and incoming/i.test(t) && /Go Bus/.test(t) && /incoming/i.test(t) && GO.every(r => t.includes(r)));
  F('Go Bus is not mixed into the running operators', await page.locator('#oplist .opcard:not(.incoming)').evaluateAll(els => els.every(e => !/Go Bus/.test(e.textContent))));
  await page.click('.opcard.incoming'); await page.waitForTimeout(900);
  const d = await text(page);
  F('its own page names it, says it is incoming and lists the three routes with the operator they leave', /Go Bus/.test(d) && /incoming/i.test(d) && GO.every(r => new RegExp(`Route ${r}`, 'i').test(d)) && /Go-Ahead London/.test(d) && /provisional/i.test(d));
  await ctx.close();
  ({ ctx, page } = await open('#/route/624'));
  F('a route being handed over says so, names the new operator and links to it', /changing operator/i.test(await text(page)) && await page.locator('.changenote a[href*="Go%20Bus"]').count() === 1);
  await ctx.close();
  ({ ctx, page } = await open('#/route/88'));
  F('routes with no changeover show no notice', await page.locator('.changenote').count() === 0);
  await ctx.close();
  ({ ctx, page } = await open('#/tender'));
  F('the tender table flags the new operator once', await page.locator('#tBody .newpill').count() >= 3 && await page.locator('#tBody tr:has(.newpill)').evaluateAll(rs => rs.every(r => /Go Bus/.test(r.textContent))));
  await ctx.close();
  ({ ctx, page } = await open('intelligence#op=Go-Ahead%20London'));
  await page.waitForSelector('#routes tbody tr', { timeout: 30000 });
  F('Intelligence notes Go Bus as new to the network without adding it to the operator list', /Go Bus.*new to the network/.test(await text(page, '#market')) && await page.evaluate(() => document.querySelectorAll('#opMenu button').length) === 9);
  F('zero page errors (incoming)', page.errors.length === 0);
  await ctx.close();
}

/* ── the day it runs routes ──────────────────────────────────────────── */
{
  let { ctx, page } = await open('#/operators', { running: true });
  const cards = await page.locator('#oplist .opcard:not(.incoming)').evaluateAll(els => els.map(e => ({ name: e.querySelector('.nm')?.textContent.trim(), bg: getComputedStyle(e.querySelector('.avatar')).backgroundColor, ini: e.querySelector('.avatar')?.textContent.trim(), text: e.textContent.replace(/\s+/g, ' ') })));
  const go = cards.find(c => c.name === 'Go Bus');
  F('Go Bus becomes a normal operator card with 3 routes and a garage', !!go && /Routes\s*3/i.test(go.text) && /Garages\s*1/i.test(go.text));
  F('it has its own colour and initials, distinct from Go-Ahead', !!go && go.bg !== cards.find(c => c.name === 'Go-Ahead London').bg && go.ini === 'GB');
  F('the incoming section is gone (the award has become the route data)', await page.locator('.opcard.incoming').count() === 0);
  await page.click('a.opcard[href*="Go%20Bus"]'); await page.waitForTimeout(900);
  const d = await text(page);
  F('its page shows routes, the garage and its zero-emission figure', /Routes\s*3/i.test(d) && /Go Bus Depot/.test(d) && /Zero-emission\s*0%/i.test(d) && GO.every(r => d.includes(r)));
  await ctx.close();
  ({ ctx, page } = await open('#/garages', { running: true }));
  F('the Garages page filters by the new operator and lists its garage', await page.locator('#gopRow').innerText().then(t => /Go Bus/.test(t)) && /Go Bus Depot/.test(await text(page)));
  await ctx.close();
  ({ ctx, page } = await open('#/map', { running: true }));
  await page.click('#nmFilters'); await page.waitForTimeout(300);
  F('the map filters offer Go Bus', /Go Bus/.test(await text(page, '#nmPop')));
  F('zero page errors (running, main site)', page.errors.length === 0);
  await ctx.close();
  ({ ctx, page } = await open('intelligence#op=Go-Ahead%20London', { running: true }));
  await page.waitForSelector('#routes tbody tr', { timeout: 30000 });
  const menu = await page.locator('#opMenu button').evaluateAll(bs => bs.map(b => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), c: getComputedStyle(b.querySelector('.dot')).backgroundColor })));
  const gb = menu.find(m => /^Go Bus/.test(m.t));
  F('Intelligence adds Go Bus as a ninth operator with a colour of its own', menu.length === 10 && /9 operators/.test(menu[0].t) && !!gb && gb.c !== 'rgb(152, 162, 179)' && new Set(menu.slice(1).map(m => m.c)).size === 9);
  await page.click('#opBtn'); await page.click('#opMenu button:has-text("Go Bus")'); await page.waitForTimeout(600);
  F('selecting it shows its own header, routes and no other operator’s', /Go Bus/.test(await text(page, '#hero h1')) && await page.locator('#routes tbody tr.row').count() === 3);
  F('and the incoming note is gone', !/new to the network/.test(await text(page, '#market')));
  F('zero page errors (running, Intelligence)', page.errors.length === 0);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} new-operator checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
