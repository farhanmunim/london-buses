/* Public API contract — checks the generated api/v1/ tree (scripts/build-v1.js) without a browser:
   every file is a valid envelope with attribution, every advertised resource exists, route slices cover every
   route, the OpenAPI paths resolve to real files, CORS/caching headers are configured, and the output stays inside
   Cloudflare Pages' free limits (25 MiB per file, 20 000 files per deploy).   Run: node tests/verify-api.mjs */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { execFileSync } from 'child_process';
const ROOT = new URL('..', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'scripts/build-v1.js')], { stdio: 'pipe' });
const V1 = join(ROOT, 'api/v1');
let pass = 0, fail = 0;
const F = (k, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + k + (ok ? '' : '  ' + extra)); ok ? pass++ : fail++; };
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const all = walk(V1);
const read = p => JSON.parse(readFileSync(p, 'utf8'));

const index = read(join(V1, 'index.json'));
const open = read(join(V1, 'openapi.json'));
const attrIds = new Set(index.data.attribution.map(a => a.id));

/* envelope on every data file */
const bad = [];
let maxBytes = 0;
for (const f of all) {
  const rel = relative(V1, f);
  maxBytes = Math.max(maxBytes, statSync(f).size);
  if (rel === 'index.json' || rel === 'openapi.json') continue;
  const j = read(f);
  const m = j.meta;
  const ok = m && m.version === 'v1' && m.resource === '/api/v1/' + rel && Array.isArray(m.attribution) && 'data' in j
    && m.attribution.every(a => attrIds.has(a.id)) && (rel === 'manifest.json' || m.attribution.length > 0);
  if (!ok) bad.push(rel);
}
F(`all ${all.length - 2} data files are valid envelopes with attribution`, bad.length === 0, bad.slice(0, 5).join(', '));

/* every advertised resource exists (templates expanded for a real route) */
const missing = [];
for (const r of index.data.resources) {
  if (r.live) continue;
  const p = r.path.replace('{id}', '88');
  if (!existsSync(join(ROOT, p))) missing.push(p);
}
F('every advertised resource exists on disk', missing.length === 0, missing.join(', '));

/* route slices */
const routes = read(join(V1, 'routes.json')).data;
const ids = routes.map(r => r.id);
const noSlice = ids.filter(id => !existsSync(join(V1, 'routes', id + '.json')));
F(`a slice exists for all ${ids.length} routes`, noSlice.length === 0, noSlice.slice(0, 5).join(', '));
F('index.routeIds matches routes.json', JSON.stringify(index.data.routeIds) === JSON.stringify(ids));
const r88 = read(join(V1, 'routes/88.json')).data;
F('route 88 slice joins meta, fleet, tenders, destinations', !!(r88.meta && r88.fleet && r88.tenders.length && r88.destinations));
F('route 88 has stops and geometry', existsSync(join(V1, 'routes/88/stops.json')) && read(join(V1, 'routes/88/geometry.json')).data.type === 'FeatureCollection');
F('datasets keep the pipeline shape (route-meta.data.routes keyed by id)', !!read(join(V1, 'route-meta.json')).data.routes['88']);

/* attribution carries the licences that need it */
const attrOf = n => read(join(V1, n + '.json')).meta.attribution.map(a => a.id);
F('tenders credits the community wiki (CC BY-SA)', attrOf('tenders').includes('fandom'));
F('fleet credits DVLA; bridges credit OpenStreetMap', attrOf('fleet').includes('dvla') && attrOf('bridges').includes('osm'));

/* OpenAPI */
const badPaths = Object.keys(open.paths).filter(p => !p.includes('{') && !p.includes('/live/') && !existsSync(join(ROOT, p)));
F('OpenAPI 3.1 and every concrete path resolves', open.openapi === '3.1.0' && badPaths.length === 0, badPaths.join(', '));

/* hosting config + free-tier limits */
const headers = readFileSync(join(ROOT, '_headers'), 'utf8');
const block = headers.split('\n').slice(headers.split('\n').indexOf('/api/v1/*'), headers.split('\n').indexOf('/api/v1/*') + 7).join('\n');
F('_headers: /api/v1/* is CORS-open and revalidates', /Access-Control-Allow-Origin: \*/.test(block) && /must-revalidate/.test(block));
F(`largest file ${(maxBytes / 1048576).toFixed(1)} MiB < 25 MiB (Pages limit)`, maxBytes < 25 * 1048576);
const repoFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).length;
F(`deploy ≈ ${repoFiles + all.length} files < 20 000 (Pages limit)`, repoFiles + all.length < 18000);

console.log(`\n${pass}/${pass + fail} API contract checks passed`);
process.exit(fail ? 1 : 0);
