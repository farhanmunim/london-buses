/* /docs — the restored documentation page: API reference + project guide.
   Checks the page renders, the live resource list and attribution come from the generated API index, every in-page
   link resolves, the old URLs redirect here, and the docs describe what is actually published.
   Run: node tests/verify-docs.mjs */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
import { execFileSync } from 'child_process';
const ROOT = new URL('..', import.meta.url).pathname;
if (!existsSync(join(ROOT, 'api/v1/index.json'))) execFileSync(process.execPath, [join(ROOT, 'scripts/build-v1.js')], { stdio: 'pipe' });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer((req, res) => {
  try {
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (u === '/docs') u = '/docs.html'; if (u.endsWith('/')) u += 'index.html';
    res.writeHead(200, { 'content-type': TYPES[extname(u)] ?? 'application/octet-stream' }); res.end(readFileSync(join(ROOT, u)));
  } catch { res.writeHead(404); res.end('nf'); }
}).listen(8974);

let pass = 0, fail = 0;
const F = (k, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k + (ok ? '' : '  ' + extra)); ok ? pass++ : fail++; };
const index = JSON.parse(readFileSync(join(ROOT, 'api/v1/index.json'), 'utf8')).data;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [], bad = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1:8974') && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await page.route(/fonts\.|googletagmanager|mochi/, r => r.abort());
  await page.goto('http://127.0.0.1:8974/docs#api', { waitUntil: 'load' }); await page.waitForTimeout(1200);

  if (scheme === 'light') {
    F('title and headline', /^Docs/.test(await page.title()) && /Documentation/.test(await page.locator('h1').textContent()));
    F('not marked noindex (public docs)', (await page.locator('meta[name=robots]').count()) === 0);
    const rows = await page.locator('#resources tr').count();
    F(`resource table lists every resource (${rows - 1} of ${index.resources.length})`, rows - 1 === index.resources.length);
    F('every attribution is listed', (await page.locator('#attribution li').count()) === index.attribution.length);
    const hrefs = await page.$$eval('#resources a', a => a.map(x => x.getAttribute('href')));
    F('resource links point at real files', hrefs.length > 20 && hrefs.every(h => existsSync(join(ROOT, h))), hrefs.filter(h => !existsSync(join(ROOT, h))).join(', '));
    const anchors = await page.$$eval('a[href^="#"]', a => [...new Set(a.map(x => x.getAttribute('href').slice(1)))].filter(Boolean));
    const missing = [];
    for (const id of anchors) if (!(await page.locator('#' + id.replace(/[^\w-]/g, '\\$&')).count())) missing.push(id);
    F(`all ${anchors.length} in-page links resolve`, missing.length === 0, missing.join(', '));
    F('#api deep link scrolls to the API section', await page.evaluate(() => { const r = document.getElementById('api').getBoundingClientRect(); return r.top < 300 && r.top > -50; }));
    const text = await page.locator('main').textContent();
    F('documents the envelope, versioning and live endpoint', /"meta"/.test(text) && /\/api\/v2/.test(text) && /live\/vehicles\?line=/.test(text));
    F('no stale "faux-API" / single-file wording', !/faux-API/i.test(text) && !/whole app\. HTML, CSS and JavaScript in one file/.test(text));
    F('lineage table still present (every dataset row)', (await page.locator('#lineage tr').count()) > 20);
    const redirects = readFileSync(join(ROOT, '_redirects'), 'utf8');
    F('_redirects: /docs is served (not redirected away); old URLs point here', !/^\/docs(\.html)?\s+\/\s/m.test(redirects) && /^\/developers\s+\/docs#api/m.test(redirects) && /^\/archive\/docs\/?\s+\/docs/m.test(redirects));
    F('sitemap lists /docs', /londonbuses\.org\/docs</.test(readFileSync(join(ROOT, 'sitemap.xml'), 'utf8')));
  }
  F(`${scheme}: no page errors and no failed requests`, errors.length === 0 && bad.length === 0, [...errors, ...bad].join('; '));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  F(`${scheme}: no horizontal page overflow at 1100px`, overflow <= 1, String(overflow));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const page = await ctx.newPage();
  await page.route(/fonts\.|googletagmanager|mochi/, r => r.abort());
  await page.goto('http://127.0.0.1:8974/docs', { waitUntil: 'load' }); await page.waitForTimeout(800);
  F('mobile: no horizontal page overflow at 390px', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  await ctx.close();
}
console.log(`\n${pass}/${pass + fail} docs checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
