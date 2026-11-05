/**
 * build-v1.js — publishes the public, versioned API at /api/v1/ from the committed datasets.
 *
 *   node scripts/build-v1.js            (run by `npm test` and by the Cloudflare Pages build)
 *
 * Output (gitignored, regenerated on every deploy — nothing generated is committed):
 *   api/v1/{dataset}.json              every dataset in scripts/_lib/api-registry.js, wrapped in the envelope
 *   api/v1/routes/{id}.json            one route, everything we know about it, joined
 *   api/v1/routes/{id}/stops.json      that route's ordered stops
 *   api/v1/routes/{id}/geometry.json   that route's GeoJSON geometry
 *   api/v1/index.json                  discovery: every resource with its URL, summary and attribution
 *   api/v1/openapi.json                OpenAPI 3.1 description (generated from the same registry)
 *
 * Envelope — every response: { meta: { api, version, resource, generatedAt, source, attribution[], notice }, data }
 * `data` is the dataset exactly as the pipeline produced it, so a consumer and the website read identical content.
 * Static files only: served by the CDN, free, no Functions invocations. Live feeds are the exception (see LIVE).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ATTRIBUTION, DATASETS, ROUTE_SLICE_ATTR, LIVE, NOTICE } from './_lib/api-registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'api', 'v1');
const ORIGIN = 'https://londonbuses.org';

const readJson = rel => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const write = (rel, obj) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
};
const attrObjects = ids => ids.map(id => {
  const a = ATTRIBUTION[id];
  if (!a) throw new Error(`unknown attribution id "${id}"`);
  return a;
});

fs.rmSync(OUT, { recursive: true, force: true });
const manifest = readJson('api/manifest.json');
let files = 0;

const stampOf = (d, name) =>
  d?.generatedAt ?? d?.capturedAt ?? d?.generated_at_utc ?? d?.metadata?.generatedAt
  ?? manifest.datasets?.[name]?.fetchedAt ?? manifest.generatedAt ?? null;

const envelope = (resource, data, { generatedAt, source, attr, cadence }) => ({
  meta: {
    api: 'londonbuses.org',
    version: 'v1',
    resource: `/api/v1/${resource}`,
    generatedAt,
    ...(source ? { source } : {}),
    ...(cadence ? { cadence } : {}),
    attribution: attrObjects(attr),
    notice: NOTICE,
  },
  data,
});

/* ── 1. datasets ─────────────────────────────────────────────────────────── */
const loaded = {};
const schemaHints = {};
const describe = v => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
for (const ds of DATASETS) {
  const data = readJson(ds.file);
  loaded[ds.name] = data;
  const mf = manifest.datasets?.[ds.name];
  write(`${ds.name}.json`, envelope(`${ds.name}.json`, data, {
    generatedAt: stampOf(data, ds.name),
    source: mf?.source ?? (typeof data?.source === 'string' ? data.source : undefined),
    cadence: mf?.cadence,
    attr: ds.attr,
  }));
  files++;
  schemaHints[ds.name] = Array.isArray(data)
    ? { type: 'array', items: { type: describe(data[0]) } }
    : { type: 'object', properties: Object.fromEntries(Object.entries(data).slice(0, 12).map(([k, v]) => [k, { type: describe(v) }])) };
}

/* ── 2. per-route slices ─────────────────────────────────────────────────── */
const routeList = loaded['routes'];
const ids = routeList.map(r => r.id);
const idSet = new Set(ids);
const pick = (name, key) => loaded[name]?.[key];
const rowsByRoute = new Map((loaded['line-status'].rows ?? []).map(r => [String(r.route), r]));
const stampMax = ['route-meta', 'fleet', 'line-status', 'route-diversions', 'tenders']
  .map(n => stampOf(loaded[n], n)).filter(Boolean).sort().at(-1);
for (const id of ids) {
  const r = routeList.find(x => x.id === id);
  const slice = {
    id,
    name: r.name,
    type: r.type,
    meta: pick('route-meta', 'routes')?.[id] ?? null,
    destinations: pick('route-destinations', 'routes')?.[id] ?? null,
    bbox: pick('route-bboxes', 'routes')?.[id] ?? null,
    fleet: pick('fleet', 'byRoute')?.[id] ?? null,
    status: rowsByRoute.get(id) ?? null,
    diversions: pick('route-diversions', 'routes')?.[id] ?? null,
    tenders: pick('tenders', 'byRoute')?.[id] ?? [],
    performance: pick('route-performance', 'routes')?.[id] ?? null,
    scheduledMileage: pick('scheduled-mileage', 'routes')?.[id] ?? null,
    crowding: pick('crowding', 'routes')?.[id] ?? null,
    links: {
      stops: `/api/v1/routes/${id}/stops.json`,
      geometry: `/api/v1/routes/${id}/geometry.json`,
    },
  };
  write(`routes/${id}.json`, envelope(`routes/${id}.json`, slice, { generatedAt: stampMax, attr: ROUTE_SLICE_ATTR }));
  files++;
  const stops = pick('route-stops', 'routes')?.[id];
  if (stops) {
    write(`routes/${id}/stops.json`, envelope(`routes/${id}/stops.json`, stops, { generatedAt: stampOf(loaded['route-stops'], 'route-stops'), attr: ['tfl', 'os'] }));
    files++;
  }
}
// geometry: every committed route file (includes routes not currently active)
let geo = 0;
for (const f of fs.readdirSync(path.join(DATA, 'routes'))) {
  if (!f.endsWith('.geojson')) continue;
  const id = f.slice(0, -'.geojson'.length);
  const g = readJson(`routes/${f}`);
  write(`routes/${id}/geometry.json`, envelope(`routes/${id}/geometry.json`, g, { generatedAt: g?.metadata?.sourceDate ?? null, source: g?.metadata?.source, attr: ['tfl', 'os'] }));
  files++; geo++;
}

/* ── 3. index + OpenAPI ──────────────────────────────────────────────────── */
const resources = [
  ...DATASETS.map(d => ({ path: `/api/v1/${d.name}.json`, summary: d.summary, attribution: d.attr })),
  { path: '/api/v1/routes/{id}.json', summary: 'One route with everything known about it, joined: meta, destinations, fleet, status, diversions, tenders, performance, mileage, crowding.', attribution: ROUTE_SLICE_ATTR },
  { path: '/api/v1/routes/{id}/stops.json', summary: 'Ordered stops for one route, by direction.', attribution: ['tfl', 'os'] },
  { path: '/api/v1/routes/{id}/geometry.json', summary: 'GeoJSON geometry for one route.', attribution: ['tfl', 'os'] },
  ...LIVE.map(l => ({ path: l.path, summary: l.summary, attribution: l.attr, live: true })),
];
write('index.json', {
  meta: { api: 'londonbuses.org', version: 'v1', resource: '/api/v1/index.json', generatedAt: manifest.generatedAt, docs: `${ORIGIN}/docs#api`, openapi: `${ORIGIN}/api/v1/openapi.json`, notice: NOTICE },
  data: { routeIds: ids, resources, attribution: Object.values(ATTRIBUTION) },
});
files++;

const envSchema = dataSchema => ({
  type: 'object', required: ['meta', 'data'],
  properties: { meta: { $ref: '#/components/schemas/Meta' }, data: dataSchema },
});
const paths = {};
for (const d of DATASETS) {
  paths[`/api/v1/${d.name}.json`] = { get: { summary: d.summary, operationId: `get_${d.name.replace(/-/g, '_')}`, tags: ['datasets'],
    responses: { 200: { description: 'OK', content: { 'application/json': { schema: envSchema(schemaHints[d.name]) } } } } } };
}
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', enum: ids }, description: 'Route id as in /api/v1/routes.json, e.g. 88, N38, X68' };
for (const [p, summary, op] of [
  ['/api/v1/routes/{id}.json', 'One route with everything known about it', 'get_route'],
  ['/api/v1/routes/{id}/stops.json', 'Ordered stops for one route', 'get_route_stops'],
  ['/api/v1/routes/{id}/geometry.json', 'GeoJSON geometry for one route', 'get_route_geometry'],
]) paths[p] = { get: { summary, operationId: op, tags: ['routes'], parameters: [idParam],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: envSchema({ type: 'object' }) } } }, 404: { description: 'No such route' } } } };
paths['/api/v1/live/vehicles'] = { get: { summary: LIVE[0].summary, operationId: 'get_live_vehicles', tags: ['live'],
  parameters: [{ name: 'line', in: 'query', required: true, schema: { type: 'string' }, description: 'Route id, e.g. 88' }],
  responses: { 200: { description: 'OK — { feed, live, cached, capturedAt, count, data[] }; Cache-Control max-age=10' } } } };
write('openapi.json', {
  openapi: '3.1.0',
  info: { title: 'londonbuses.org API', version: '1.0.0', description: `Open data on London's bus network: routes, stops, geometry, operators, garages, fleet, tenders, service status, diversions and road works. Static JSON, CORS-open, no key. Every response carries its attribution in meta.attribution — please keep it with the data. ${NOTICE}`, license: { name: 'See meta.attribution per response' } },
  servers: [{ url: ORIGIN }],
  tags: [{ name: 'datasets' }, { name: 'routes' }, { name: 'live' }],
  paths,
  components: { schemas: { Meta: {
    type: 'object',
    properties: {
      api: { type: 'string' }, version: { type: 'string' }, resource: { type: 'string' },
      generatedAt: { type: ['string', 'null'], format: 'date-time' }, source: { type: 'string' }, cadence: { type: 'string' },
      attribution: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, url: { type: 'string' }, licence: { type: 'string' } } } },
      notice: { type: 'string' },
    } } } },
});
files++;

console.log(`api/v1: ${files} files (${DATASETS.length} datasets, ${ids.length} route slices, ${geo} geometries)`);
