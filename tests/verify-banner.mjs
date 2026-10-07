/* Banner suite — the sunset banner was removed 2026-09-08. (The site-wide
   migration notice in site-banner.js is separate and is checked below.) The main app and
   404 must carry NO sunset banner at all; the archived v1 pages keep only their
   "Archived v1" notice (no sunset wording anywhere).
   Run: node tests/verify-banner.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  }catch(e){ try{ res.writeHead(404); }catch{} res.end('nf'); }
}).listen(8902);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const F = (k, ok) => { console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };
for(const [url, scheme, wantArchiveNote] of [
  ['/', 'light', false], ['/', 'dark', false], ['/404.html', 'light', false],
  ['/archive/v1/', 'light', true], ['/archive/v1/changelog.html', 'light', true],
]){
  const ctx = await browser.newContext({ viewport:{width:1280,height:900}, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.route(/atlas\.farhan\.app|unpkg|cartocdn|openstreetmap\.org|fonts\.|googletagmanager/, r => r.abort());
  await page.goto('http://127.0.0.1:8902'+url, { waitUntil:'domcontentloaded' }); await page.waitForTimeout(1200);
  const b = await page.evaluate(() => {
    const el = document.querySelector('.sunset-banner');
    return {
      bodyHasSunset: /sunset soon/i.test(document.body.textContent),
      bannerText: el ? el.textContent.trim() : null,
    };
  });
  F(`${url} (${scheme}): no "sunset soon" text anywhere`, !b.bodyHasSunset);
  const mb = await page.evaluate(() => { const e = document.getElementById('site-banner'); if(!e) return null; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { top:Math.round(r.top), w:Math.round(r.width), bg:c.backgroundColor, fg:c.color, text:e.textContent }; });
  F(`${url} (${scheme}): slim black migration banner at the very top, full width`, !!mb && mb.top === 0 && mb.w >= 1270 && mb.bg === 'rgb(11, 11, 12)' && mb.fg === 'rgb(255, 255, 255)' && /System upgrade in progress/.test(mb.text));
  if(wantArchiveNote){
    F(`${url}: archive notice present ("${(b.bannerText ?? '').slice(0,40)}…")`,
      !!b.bannerText && /Archived v1/.test(b.bannerText));
  } else {
    F(`${url} (${scheme}): no banner element`, b.bannerText === null);
  }
  await ctx.close();
}
console.log(`\n${pass}/${pass+fail} banner checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
