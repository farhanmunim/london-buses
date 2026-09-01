import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = '/home/user/london-buses/';
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8912);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:375,height:720}, isMobile:true, hasTouch:true, deviceScaleFactor:2 })).newPage();
await page.route(/unpkg|cartocdn|openstreetmap|fonts\.|api\.tfl|atlas\.|\/api\/live\//, r => r.abort());
await page.goto('http://127.0.0.1:8912/v2/#/tenders', { waitUntil:'load' });
await page.waitForTimeout(2500);
const bar = await page.$('.tabbar');
const b = await bar.boundingBox();
await page.screenshot({ path: '/home/user/london-buses/tests/nav.png', clip: b });
// also the tenders page top on mobile
await page.screenshot({ path: '/home/user/london-buses/tests/tenders-mobile.png', clip: { x:0, y:0, width:375, height:660 } });
await browser.close(); srv.close();
console.log('done');
