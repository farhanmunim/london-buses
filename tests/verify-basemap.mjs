/* Basemap — OpenFreeMap Bright (MapLibre via the Leaflet bridge) with CARTO as
   the fallback, driven in a real browser. Covers the vector path, dark mode,
   a failed style, a blocked library, no WebGL, and the sticky fallback.
   OpenFreeMap itself is mocked with a tiny inline style, so this passes offline.
   Needs WebGL (swiftshader works headless). Run: node tests/verify-basemap.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const FIX = join(ROOT, 'tests/fixtures/');
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8931);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };

// A minimal valid style: background + a filled shape + a label, all inline.
const SHAPE = { type:'FeatureCollection', features:[{ type:'Feature', properties:{}, geometry:{ type:'Polygon', coordinates:[[[-0.2,51.45],[-0.0,51.45],[-0.0,51.58],[-0.2,51.58],[-0.2,51.45]]] } },
                                                   { type:'Feature', properties:{}, geometry:{ type:'Point', coordinates:[-0.1,51.5] } }] };
const MOCK_STYLE = { version:8, glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources:{ s:{ type:'geojson', data:SHAPE } },
  layers:[ { id:'background', type:'background', paint:{ 'background-color':'#f2efe9' } },
           { id:'blob', type:'fill', source:'s', filter:['==','$type','Polygon'], paint:{ 'fill-color':'#cfe8c9' } },
           { id:'lbl', type:'symbol', source:'s', filter:['==','$type','Point'], layout:{ 'text-field':'Test', 'text-font':['Noto Sans Regular'] } } ] };

async function scenario(name, { dark=false, style='ok', lib='ok', webgl=true, hash='#/route/25', after=null } = {}){
  const ctx = await browser.newContext({ viewport:{ width:1100, height:800 } });
  const page = await ctx.newPage();
  const errors = [], seen = { carto:0, style:0, lib:0 };
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if(m.type() === 'error' && /pageerror/.test(m.text())) errors.push(m.text()); });
  if(dark) await page.addInitScript(() => localStorage.setItem('v2-theme', 'dark'));
  else await page.addInitScript(() => localStorage.setItem('v2-theme', 'light'));
  if(!webgl) await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(t, ...a){ return /webgl/.test(t) ? null : orig.call(this, t, ...a); };
  });
  await page.route('**://unpkg.com/**', r => {
    const u = r.request().url();
    if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body:readFileSync(FIX+'leaflet-heat.js','utf8') });
    if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body:readFileSync(FIX+'leaflet.js','utf8') });
    if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body:readFileSync(FIX+'leaflet.css','utf8') });
    if(/maplibre/.test(u)){
      seen.lib++;
      if(lib === 'blocked') return r.abort();
      if(u.endsWith('/leaflet-maplibre-gl.js')) return r.fulfill({ contentType:'text/javascript', body:readFileSync(FIX+'leaflet-maplibre-gl.js','utf8') });
      if(u.endsWith('/maplibre-gl.js')) return r.fulfill({ contentType:'text/javascript', body:readFileSync(FIX+'maplibre-gl.js','utf8') });
      if(u.endsWith('/maplibre-gl.css')) return r.fulfill({ contentType:'text/css', body:readFileSync(FIX+'maplibre-gl.css','utf8') });
    }
    return r.abort();
  });
  await page.route('https://tiles.openfreemap.org/**', r => {
    const u = r.request().url();
    if(/\/styles\//.test(u)){
      seen.style++;
      return style === 'fail' ? r.fulfill({ status:500, body:'boom' })
        : r.fulfill({ contentType:'application/json', headers:{ 'access-control-allow-origin':'*' }, body:JSON.stringify(MOCK_STYLE) });
    }
    return r.fulfill({ status:200, contentType:'application/x-protobuf', headers:{ 'access-control-allow-origin':'*' }, body:'' });   // empty glyph range
  });
  await page.route(/basemaps\.cartocdn\.com/, r => { seen.carto++; r.abort(); });
  await page.route(/openstreetmap\.org|fonts\.|googletagmanager|api\.tfl\.gov\.uk|\/api\/live\//, r => r.abort());
  await page.goto('http://127.0.0.1:8931/' + hash, { waitUntil:'load' });
  const kind = async () => page.evaluate(() => document.querySelector('.leaflet-container')?.dataset.basemap ?? null);
  // settle: vector resolves to 'vector', fallbacks to 'carto' (up to the 12 s load timeout + margin)
  const want = (dark || style === 'fail' || lib === 'blocked' || !webgl) ? 'carto' : 'vector';
  await page.waitForFunction(w => document.querySelector('.leaflet-container')?.dataset.basemap === w, want, { timeout:20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const got = await kind();
  const info = await page.evaluate(() => ({
    glBase: document.querySelectorAll('.leaflet-tile-pane .leaflet-gl-layer canvas').length,
    glLabels: document.querySelectorAll('.leaflet-placelabels-pane .leaflet-gl-layer canvas').length,
    tiles: document.querySelectorAll('.leaflet-tile').length,
    attr: document.querySelector('.lb-attr-txt')?.textContent ?? '',
    routes: document.querySelectorAll('.leaflet-overlay-pane canvas, .leaflet-overlay-pane path').length,
  }));
  if(after) await after(page, seen, F);
  await ctx.close();
  return { got, info, seen, errors };
}

// A. light + healthy → vector, two GL layers in the right panes, no CARTO traffic
{ const r = await scenario('vector', { after: async (page, seen, F) => {
    const st = () => page.evaluate(() => { const t = document.querySelector('.lb-attr-txt'), b = document.querySelector('.lb-attr-btn');
      return { shown: !!t && !t.hidden && getComputedStyle(t).display !== 'none', btn: !!b && getComputedStyle(b).display !== 'none', exp: b?.getAttribute('aria-expanded'), label: b?.getAttribute('aria-label') }; });
    const s0 = await st();
    F('credit: only the ⓘ button shows by default (text collapsed)', s0.btn && !s0.shown && s0.exp === 'false' && s0.label === 'Map credits');
    await page.click('.lb-attr-btn');
    const s1 = await st();
    F('credit: clicking ⓘ reveals the OpenFreeMap / OpenStreetMap credit', s1.shown && s1.exp === 'true'
      && /OpenFreeMap/.test(await page.textContent('.lb-attr-txt')) && await page.locator('.lb-attr-txt a').count() >= 3);
    await page.keyboard.press('Escape');
    F('credit: Escape closes it', !(await st()).shown);
    await page.click('.lb-attr-btn');
    const mb = await page.locator('.leaflet-container').boundingBox();
    await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
    F('credit: a click on the map closes it', !(await st()).shown);
  } });
  F(`light: basemap is vector (${r.got})`, r.got === 'vector');
  F(`light: base GL canvas in tile pane, labels GL canvas in labels pane (${r.info.glBase}/${r.info.glLabels})`, r.info.glBase === 1 && r.info.glLabels === 1);
  F('light: no CARTO tiles requested', r.seen.carto === 0);
  F(`light: OpenFreeMap credit shown`, /OpenFreeMap/.test(r.info.attr) && /OpenStreetMap/.test(r.info.attr));
  F('light: route lines still drawn by Leaflet', r.info.routes > 0);
  F('light: zero page errors', r.errors.length === 0); if(r.errors.length) console.log(r.errors); }

// B. dark → CARTO dark tiles, vector library never needed
{ const r = await scenario('dark', { dark:true });
  F(`dark: basemap is carto (${r.got})`, r.got === 'carto');
  F('dark: CARTO tiles requested, no GL layers', r.seen.carto > 0 && r.info.glBase === 0);
  F('dark: CARTO credit shown', /CARTO/.test(r.info.attr));
  F('dark: vector library not downloaded', r.seen.lib === 0);
  F('dark: zero page errors', r.errors.length === 0); }

// C. style endpoint fails → falls back to CARTO, GL layers gone
{ const r = await scenario('style-fail', { style:'fail' });
  F(`style failure: falls back to carto (${r.got})`, r.got === 'carto');
  F('style failure: CARTO tiles requested, no GL layers left', r.seen.carto > 0 && r.info.glBase === 0 && r.info.glLabels === 0);
  F('style failure: credit switched to CARTO', /CARTO/.test(r.info.attr) && !/OpenFreeMap/.test(r.info.attr));
  F('style failure: zero page errors', r.errors.length === 0); }

// D. MapLibre files blocked (offline CDN) → CARTO
{ const r = await scenario('lib-blocked', { lib:'blocked' });
  F(`library blocked: falls back to carto (${r.got})`, r.got === 'carto');
  F('library blocked: CARTO tiles requested', r.seen.carto > 0);
  F('library blocked: zero page errors', r.errors.length === 0); }

// E. no WebGL → straight to CARTO, nothing downloaded
{ const r = await scenario('no-webgl', { webgl:false });
  F(`no WebGL: carto (${r.got})`, r.got === 'carto');
  F('no WebGL: library and style never fetched', r.seen.lib === 0 && r.seen.style === 0);
  F('no WebGL: zero page errors', r.errors.length === 0); }

// F. after a failure the session sticks to CARTO for other maps (no repeat style fetch)
{ const r = await scenario('sticky', { style:'fail', after: async (page, seen, F) => {
    const before = seen.style;
    await page.evaluate(() => { location.hash = '#/map'; });
    await page.waitForFunction(() => document.querySelector('.leaflet-container')?.dataset.basemap === 'carto', null, { timeout:10000 }).catch(() => {});
    await page.waitForTimeout(800);
    F(`sticky: second map used carto without re-fetching the style (${before}→${seen.style})`, seen.style === before
      && await page.evaluate(() => document.querySelector('.leaflet-container')?.dataset.basemap) === 'carto');
  } });
  F('sticky: zero page errors', r.errors.length === 0); }

console.log(`\n${pass}/${pass+fail} basemap checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
