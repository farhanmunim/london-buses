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
await page.waitForSelector('#attrBody p.note', { timeout: 15000 });

const body = await page.locator('#attrBody').textContent();
const notices = credits.filter(c => c.notice), main = credits.filter(c => c.main);
F(`required notices shown in full (${notices.map(c => c.id).join(', ')})`, notices.length === 3 && notices.every(c => body.includes(c.text)));
F('a single paragraph, no list', (await page.locator('#attrBody p').count()) === 1 && (await page.locator('#attrBody li').count()) === 0);
const links = await page.$$eval('#attrBody a', a => a.map(x => ({ href: x.href, rel: x.rel, text: x.textContent })));
F(`names the main providers, each linked safely (${main.map(c => c.id).join(', ')})`, main.every(c => links.some(l => l.href === new URL(c.url).href && /noopener/.test(l.rel) && l.text === c.short)));
F('the long tail is not on the page, but is one link away', !/bustimes|postcodes\.io|JetBrains/.test(body) && (await page.locator('#attrBody a[href="/docs#api"]').count()) > 0);
F('must-have providers present (DfT, DVLA, ONS, londonbusroutes.net, wiki, OpenStreetMap)', ['dft', 'dvla', 'ons', 'lbr', 'fandom', 'osm'].every(id => main.some(c => c.id === id)));
F('wiki share-alike (CC BY-SA) and DVLA aggregate-only are stated', /CC BY-SA/.test(body) && /aggregates only/.test(body));
F('no page errors', errors.length === 0, errors.join('; '));
console.log(`\n${pass}/${pass + fail} about-attribution checks passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
