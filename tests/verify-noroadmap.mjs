import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = '/home/user/london-buses';
const srv = createServer((req, res) => {
  try{
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.xlsx':'application/octet-stream' }[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  }catch(e){ res.writeHead(404); res.end('nf'); }
}).listen(8903);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:1380,height:900} })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
await page.route(/atlas\.farhan\.app|cartocdn|fonts\./, r => r.abort());
await page.route('**://unpkg.com/**', r => {
  const u = r.request().url();
  if(u.endsWith('leaflet.js'))  return r.fulfill({ contentType:'text/javascript', body: readFileSync(ROOT+'/tests/fixtures/leaflet.js') });
  if(u.endsWith('leaflet.css')) return r.fulfill({ contentType:'text/css', body: readFileSync(ROOT+'/tests/fixtures/leaflet.css') });
  return r.abort();
});
let pass=0, fail=0; const F=(k,ok)=>{ console.log((ok?'PASS':'FAIL')+'  '+k); ok?pass++:fail++; };
await page.goto('http://127.0.0.1:8903/', {waitUntil:'load'}); await page.waitForTimeout(3500);
F('v1: no Roadmap button or text', await page.evaluate(() => !document.getElementById('roadmap-btn') && !/roadmap/i.test(document.body.innerText)));
F('v1: About button still present', await page.evaluate(() => !!document.querySelector('#about-btn, [id*=about]')));
F('v1: routes render (sidebar count)', await page.evaluate(() => document.body.innerText.length > 500));
await page.goto('http://127.0.0.1:8903/changelog.html', {waitUntil:'load'}); await page.waitForTimeout(1500);
F('changelog: loads, no Roadmap button', await page.evaluate(() => !document.getElementById('roadmap-btn') && document.body.innerText.includes('Changelog')));
F('zero page errors', errors.length === 0);
if(errors.length) console.log(errors.slice(0,4));
console.log(`${pass}/${pass+fail} checks passed`);
await browser.close(); srv.close();
process.exit(fail?1:0);
