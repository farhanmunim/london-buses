/* Mobile-responsiveness audit — every v2 view at iPhone width must not
   overflow horizontally, the bottom nav must fit, and interactive rows
   must wrap. Run: node tests/verify-mobile.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const FIX = join(ROOT, 'tests/fixtures/');
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8911);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:375,height:720}, hasTouch:true, isMobile:true, deviceScaleFactor:2 })).newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX+'leaflet-heat.js','utf8') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX+'leaflet.js','utf8') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: readFileSync(FIX+'leaflet.css','utf8') });
  return r.abort();
});
await page.route(/cartocdn|openstreetmap\.org|fonts\.|api\.tfl\.gov\.uk|atlas\.farhan\.app|\/api\/live\//, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL') + '  ' + k); ok?pass++:fail++; };

const views = ['#/', '#/route/482', '#/route/88', '#/tender', '#/cpi', '#/map', '#/stops', '#/operators', '#/garages', '#/operator/Metroline', '#/garage/Q', '#/about'];
for (const v of views){
  await page.goto('http://127.0.0.1:8911/v2/' + v, { waitUntil:'load' });
  await page.waitForTimeout(v.includes('map') || v.includes('route/') ? 4000 : 2000);
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navW: document.querySelector('.tabbar, nav.bottom, .bnav, #navMobile, body > nav:last-of-type')?.scrollWidth ?? 0,
  }));
  F(`no horizontal overflow at 375px — ${v} (${r.overflow}px)`, r.overflow <= 1);
}
const nav = await page.evaluate(() => {
  const bar = [...document.querySelectorAll('.tabbar a')];
  const rects = bar.map(a => a.getBoundingClientRect());
  const clipped = bar.filter(a => { const l = a.lastChild; return l && l.nodeType === 3 && a.scrollWidth > a.clientWidth + 1; }).length;
  return { n: bar.length, minW: Math.min(...rects.map(r => r.width)), maxRight: Math.max(...rects.map(r => r.right)), clipped };
});
F(`bottom nav fits (${nav.n} tabs, min ${Math.round(nav.minW)}px, right ${Math.round(nav.maxRight)}, ${nav.clipped} clipped)`, nav.maxRight <= 376 && nav.minW >= 44 && nav.clipped === 0);
const kpiClip = await page.evaluate(async () => {
  location.hash = '#/tender'; await new Promise(r => setTimeout(r, 1500));
  return [...document.querySelectorAll('#tKpis .fact .l')].filter(el => el.scrollWidth > el.clientWidth + 1).length;
});
F(`KPI labels never truncate on mobile (${kpiClip} clipped)`, kpiClip === 0);
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`\n${pass}/${pass+fail} mobile checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
