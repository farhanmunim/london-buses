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
for(const [url, scheme] of [['/archive/v1/', 'light'], ['/archive/v1/changelog.html', 'light'], ['/404.html', 'light'], ['/', 'light'], ['/', 'dark']]){
  const ctx = await browser.newContext({ viewport:{width:1280,height:900}, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.route(/atlas\.farhan\.app|unpkg|cartocdn|openstreetmap\.org|fonts\./, r => r.abort());
  await page.goto('http://127.0.0.1:8902'+url, { waitUntil:'domcontentloaded' }); await page.waitForTimeout(1200);
  const b = await page.evaluate(() => {
    const el = document.querySelector('.sunset-banner');
    if(!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const hdr = document.querySelector('header');
    return { text: el.textContent.trim(), top: r.top, visible: r.height > 10 && cs.display !== 'none',
      aboveHeader: !hdr || r.top <= hdr.getBoundingClientRect().top, bg: cs.backgroundColor };
  });
  F(`${url} (${scheme}): banner visible above header ("${b?.text.slice(0,30)}…", bg ${b?.bg})`,
    !!b && b.visible && b.aboveHeader && /sunset soon/.test(b.text));
  await ctx.close();
}
console.log(`\n${pass}/${pass+fail} banner checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
