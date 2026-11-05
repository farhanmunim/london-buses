/* About page attribution — every credit in data/attribution.json (the single list also served by the API and /docs)
   must appear on the About page with a working link and its licence, grouped data vs maps/software.
   Run: node tests/verify-about.mjs */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, join } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const FIX = join(ROOT, 'tests/fixtures/');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer((req, res) => {
  try { let u = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (u.endsWith('/')) u += 'index.html';
    res.writeHead(200, { 'content-type': TYPES[extname(u)] ?? 'application/octet-stream' }); res.end(readFileSync(join(ROOT, u))); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(8975);
let pass = 0, fail = 0;
const F = (k, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k + (ok ? '' : '  ' + extra)); ok ? pass++ : fail++; };
const credits = JSON.parse(readFileSync(join(ROOT, 'data/attribution.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**://unpkg.com/**', r => { const u = r.request().url(); const f = u.endsWith('leaflet-heat.js') ? 'leaflet-heat.js' : u.endsWith('leaflet.js') ? 'leaflet.js' : u.endsWith('leaflet.css') ? 'leaflet.css' : null;
  return f ? r.fulfill({ contentType: f.endsWith('css') ? 'text/css' : 'text/javascript', body: readFileSync(FIX + f) }) : r.abort(); });
await page.route(/cartocdn|openstreetmap\.org|openfreemap|fonts\.|googletagmanager|mochi|api\.tfl\.gov\.uk|\/api\/live\//, r => r.abort());
await page.goto('http://127.0.0.1:8975/#/about', { waitUntil: 'load' });
await page.waitForSelector('#attrBody ul.attr li', { timeout: 15000 });

const items = await page.$$eval('#attrBody li', li => li.map(l => ({ text: l.textContent, href: l.querySelector('a')?.href, rel: l.querySelector('a')?.rel })));
F(`${credits.length} credits listed (data/attribution.json)`, items.length === credits.length, `${items.length}`);
const missing = credits.filter(c => !items.some(i => i.text.includes(c.text) && i.text.includes(c.licence)));
F('each shows its credit text and licence', missing.length === 0, missing.map(m => m.id).join(', '));
F('each links to its source, opening safely', credits.every(c => items.some(i => i.href === new URL(c.url).href && /noopener/.test(i.rel))));
const groups = await page.$$eval('#attrBody h3', h => h.map(x => x.textContent));
F('grouped: Data / Maps, software and fonts', groups.join('|') === 'Data|Maps, software and fonts');
const ids = new Set(['tfl', 'dvla', 'fandom', 'dvsa', 'lbr', 'ons', 'dft', 'osm']);
F('the sources that need explicit credit are present (TfL, DVLA, wiki, DVSA, LBR, ONS, DfT, OSM)', [...ids].every(id => credits.some(c => c.id === id)));
const text = await page.locator('#attrBody').textContent();
F('wiki credit states CC BY-SA; DVLA credit states derived/no personal data', /CC BY-SA/.test(text) && /no keeper or personal data/.test(text));
F('no page errors', errors.length === 0, errors.join('; '));
console.log(`\n${pass}/${pass + fail} about-attribution checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
