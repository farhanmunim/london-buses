import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = '/home/user/london-buses/';
const FIX = join(ROOT, 'tests/fixtures/');
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8907);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1000,height:900}, deviceScaleFactor:2 })).newPage();
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet-heat.js')) return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX+'leaflet-heat.js','utf8') });
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: readFileSync(FIX+'leaflet.js','utf8') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: readFileSync(FIX+'leaflet.css','utf8') });
  return r.abort();
});
await page.route(/cartocdn|openstreetmap|fonts\.|api\.tfl\.gov|atlas\.|\/api\/live\//, r => r.abort());
await page.goto('http://127.0.0.1:8907/v2/#/route/117', { waitUntil:'load' });
await page.waitForTimeout(3500);
const sec = await page.evaluateHandle(() => [...document.querySelectorAll('.section-h')].find(h => /Cost per mile/.test(h.textContent)).closest('.section'));
await sec.asElement().scrollIntoViewIfNeeded();
// hover the operator-change point (3rd hit) so the tooltip shows in the shot
await page.evaluate(() => {
  const hits = [...document.querySelectorAll('.cpm-hit')];
  hits[3]?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
});
await page.waitForTimeout(400);
const box = await sec.asElement().boundingBox();
await page.screenshot({ path: '/home/user/london-buses/tests/chart.png', clip: box });
await browser.close(); srv.close();
console.log('shot done');
