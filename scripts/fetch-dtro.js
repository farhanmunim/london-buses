/**
 * fetch-dtro.js — Digital Traffic Regulation Orders (DfT D-TRO service).
 *
 * The statutory TROs behind closures, bus lanes, bus gates, banned turns
 * and diversions — published to DfT's central store by each Traffic
 * Regulation Authority (mandatory for new orders from autumn 2026).
 * API: https://dtro.dft.gov.uk/v1 (OAuth2 client-credentials; the search
 * endpoint takes a WKT polygon in EPSG:27700 and pages 50 at a time;
 * results are summaries, the full order comes from GET /dtros/{id}).
 * Spec + examples: github.com/department-for-transport-public/D-TRO.
 *
 * Strategy:
 *   1. Token: POST /oauth-generator, HTTP Basic (key:secret),
 *      grant_type=client_credentials. x-app-id carries the app id.
 *   2. Search Greater London (BNG bounding polygon), newest first isn't
 *      offered — page through everything (bounded), or incrementally via
 *      publicationTime > watermark on later runs.
 *   3. Fetch each new/changed order in full, extract the bus-relevant
 *      provisions (busRoute-flagged places, bus regulation types, closures
 *      and their diversionRoute geometries), convert BNG WKT → WGS84 and
 *      corridor-join regulation locations to bus routes (35 m, same
 *      approach as fetch-roadworks.js).
 *   4. Accumulate in data/source/dtro.json (keyed by order id, watermark
 *      for incremental runs); serve data/api/dtro.json. Revocations stay
 *      in the archive flagged by their orderReportingPoint.
 *
 * Requires DTRO_CLIENT_ID + DTRO_API_KEY + DTRO_CLIENT_SECRET (GitHub
 * Actions secrets / .env). Missing credentials = soft skip so local runs
 * and forks stay green. Upstream failures keep last-known-good.
 *
 * Run: npm run fetch-dtro   (--selftest processes tests/fixtures/dtro/*
 * through the transform instead of calling the API)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';
import { wktToCoords } from './_lib/osgb.js';
import { loadEnv } from './_lib/env.js';
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ACC_PATH = path.join(ROOT, 'data', 'source', 'dtro.json');
const API_PATH = path.join(ROOT, 'data', 'api', 'dtro.json');
const BASE     = process.env.DTRO_BASE_URL ?? 'https://dtro.dft.gov.uk/v1';
const SCRIPT   = 'dtro';
const JOIN_METRES = 35;
const PAGE_SIZE = 50;
const MAX_PAGES = 400;               // 20k orders/run — raise when London fills in
const MAX_DETAIL = 600;              // full-order fetches per run (incremental catches the rest)
// DfT enforces a 120-requests/minute spike arrest across ALL endpoints
// (search pages + detail fetches). First live run learned this the hard
// way: 279 of 448 detail fetches came back 429. Pace every call under
// the limit, and on a 429 wait out the window once before retrying.
const THROTTLE_MS = 550;             // ~109 req/min
const RATE_RETRY_MS = 65000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function pace() {
  const wait = lastCall + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

// Greater London in BNG, generous margins (matches the network's extent).
const LONDON_POLY = 'POLYGON((501000 153000, 565000 153000, 565000 204000, 501000 204000, 501000 153000))';

// Regulation types that shape how buses move — kept even without the
// busRoute flag (TRAs are still learning to set it).
const BUS_REGULATIONS = new Set([
  'miscRoadClosure', 'miscRoadClosureCrossingPoint', 'miscLaneClosure',
  'miscBusGate', 'miscBusLaneWithTrafficFlow', 'miscContraflowBusLane',
  'miscBusOnlyStreet', 'miscSuspensionOfBusway', 'miscSuspensionOfOneWay',
  'miscPedestrianZone',
  'bannedMovementNoEntry', 'bannedMovementNoLeftTurn', 'bannedMovementNoRightTurn', 'bannedMovementNoUTurn',
  'mandatoryDirectionOneWay', 'mandatoryDirectionAheadOnly', 'mandatoryDirectionLeftTurnOnly', 'mandatoryDirectionRightTurnOnly',
  'kerbsideRedRouteBusStopClearway', 'nonOrderKerbsideBusStop',
  'movementOrderProhibitedAccess',
]);

/* ── Route corridor join (same mechanics as fetch-roadworks.js) ─────────── */
const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
function pointSegDistM(lon, lat, ax, ay, bx, by, kx) {
  const P = [(lon - ax) * kx, (lat - ay) * M_PER_DEG_LAT];
  const B = [(bx - ax) * kx, (by - ay) * M_PER_DEG_LAT];
  const len2 = B[0] * B[0] + B[1] * B[1];
  let t = len2 ? (P[0] * B[0] + P[1] * B[1]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - t * B[0], P[1] - t * B[1]);
}
function loadRouteGeometries() {
  const geoms = new Map();
  try {
    const bboxes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'api', 'route-bboxes.json'), 'utf8')).routes;
    for (const id of Object.keys(bboxes)) {
      try {
        const gj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', `${id}.geojson`), 'utf8'));
        const runs = [];
        for (const f of (gj.features ?? [])) {
          const g = f.geometry;
          if (g?.type === 'LineString') runs.push(g.coordinates);
          else if (g?.type === 'MultiLineString') runs.push(...g.coordinates);
        }
        if (runs.length) geoms.set(id, { bbox: bboxes[id], runs });
      } catch { /* no geometry for this route */ }
    }
  } catch { /* bboxes absent (fresh clone mid-pipeline) — join yields [] */ }
  return geoms;
}
function routesNearCoords(coords, geoms) {
  const hits = new Set();
  const pad = JOIN_METRES * 1.5;
  for (const [lat, lon] of coords) {
    const kx = mPerDegLon(lat);
    const dLon = pad / kx, dLat = pad / M_PER_DEG_LAT;
    for (const [id, { bbox, runs }] of geoms) {
      if (hits.has(id)) continue;
      const [w, s, e, n] = Array.isArray(bbox) ? bbox : [bbox.w, bbox.s, bbox.e, bbox.n];
      if (lon < w - dLon || lon > e + dLon || lat < s - dLat || lat > n + dLat) continue;
      let best = Infinity;
      for (const run of runs) {
        for (let i = 1; i < run.length && best > JOIN_METRES; i++) {
          const d = pointSegDistM(lon, lat, run[i - 1][0], run[i - 1][1], run[i][0], run[i][1], kx);
          if (d < best) best = d;
        }
        if (best <= JOIN_METRES) break;
      }
      if (best <= JOIN_METRES) hits.add(id);
    }
  }
  return [...hits].sort();
}

/* ── D-TRO → compact order record ───────────────────────────────────────── */
// Geometry lives under one of four keys per regulated place (v4 data model).
function placeWkt(rp) {
  return rp?.linearGeometry?.linestring ?? rp?.directedLinear?.directedLineString
    ?? rp?.polygon?.polygon ?? rp?.pointGeometry?.point ?? null;
}
const asArray = (v) => Array.isArray(v) ? v : v == null ? [] : [v];

function extractOrder(id, doc, meta, geoms) {
  const src = doc?.data?.source ?? doc?.data?.Source ?? {};
  const provisions = [];
  let anyBusFlag = false, anyBusReg = false;
  for (const p of asArray(src.provision ?? src.Provision)) {
    const regs = asArray(p.regulation ?? p.Regulation);
    const regTypes = [...new Set(regs.map(r =>
      r?.generalRegulation?.regulationType ?? r?.speedLimitValueBased?.type ?? r?.speedLimitProfileBased?.type
      ?? r?.offListRegulation?.regulationShortName ?? null).filter(Boolean))];
    const times = regs.map(r => r?.condition?.timeValidity ?? r?.conditionSet?.timeValidity ?? null).filter(Boolean);
    const places = [];
    for (const rp of asArray(p.regulatedPlace ?? p.RegulatedPlace)) {
      const coords = wktToCoords(placeWkt(rp));
      if (rp.busRoute === true) anyBusFlag = true;
      places.push({
        type: rp.type ?? 'regulationLocation',
        description: String(rp.description ?? '').slice(0, 300) || null,
        busRoute: rp.busRoute === true,
        coords,
      });
    }
    if (regTypes.some(t => BUS_REGULATIONS.has(t))) anyBusReg = true;
    provisions.push({
      reference: p.reference ?? null,
      actionType: p.actionType ?? null,
      orderReportingPoint: p.orderReportingPoint ?? null,
      description: String(p.provisionDescription ?? '').slice(0, 400) || null,
      regulationTypes: regTypes,
      start: times.map(t => t.start).filter(Boolean).sort()[0] ?? null,
      end: times.map(t => t.end).filter(Boolean).sort().pop() ?? null,
      places,
    });
  }
  const joinCoords = provisions.flatMap(p => p.places
    .filter(pl => pl.type !== 'diversionRoute' && pl.coords).flatMap(pl => pl.coords));
  return {
    id,
    troName: meta?.troName ?? src.troName ?? null,
    tra: src.currentTraOwner ?? meta?.trafficAuthorityOwnerId ?? null,
    traName: meta?.traName ?? null,
    publicationTime: meta?.publicationTime ?? null,
    lastUpdated: meta?.lastUpdated ?? meta?.publicationTime ?? null,
    busRouteFlag: anyBusFlag,
    busRelevant: anyBusFlag || anyBusReg,
    provisions,
    routes: joinCoords.length ? routesNearCoords(joinCoords, geoms) : [],
  };
}

/* ── API client ─────────────────────────────────────────────────────────── */
function redact(text, secrets) {
  let t = String(text ?? '');
  for (const s of secrets) if (s) t = t.replaceAll(s, '[redacted]');
  return t;
}
async function getToken(key, secret) {
  const res = await fetchWithTimeout(`${BASE}/oauth-generator`, {
    method: 'POST',
    headers: {
      ...userAgentHeaders(SCRIPT),
      authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  }, 30000);
  const body = await res.text();
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${redact(body, [key, secret]).slice(0, 300)}`);
  const tok = JSON.parse(body).access_token;
  if (!tok) throw new Error('token response had no access_token');
  return tok;
}
async function api(pathname, token, appId, init = {}, rateRetried = false) {
  await pace();
  const res = await fetchWithTimeout(`${BASE}${pathname}`, {
    ...init,
    headers: {
      ...userAgentHeaders(SCRIPT),
      authorization: `Bearer ${token}`,
      'x-app-id': appId,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  }, 45000);
  const text = await res.text();
  if (res.status === 429 && !rateRetried) {
    console.warn(`  ${pathname} rate-limited — waiting ${RATE_RETRY_MS / 1000}s for the window to reset`);
    await sleep(RATE_RETRY_MS);
    return api(pathname, token, appId, init, true);
  }
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/* ── Accumulator + write ────────────────────────────────────────────────── */
function loadAcc() {
  try { return JSON.parse(fs.readFileSync(ACC_PATH, 'utf8')); }
  catch { return { watermark: null, orders: {} }; }
}
const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
function writeStable(p, obj) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* first run */ }
  if (!prev || stable(prev) !== stable(obj)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
    return true;
  }
  return false;
}
function writeOutputs(acc, note) {
  const nowIso = new Date().toISOString();
  writeStable(ACC_PATH, sanitizeRecord({ generatedAt: nowIso, watermark: acc.watermark, orders: acc.orders }));
  const list = Object.values(acc.orders).filter(o => o.busRelevant)
    .sort((a, b) => String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? '')));
  const tras = {};
  for (const o of Object.values(acc.orders)) tras[o.traName ?? o.tra ?? '?'] = (tras[o.traName ?? o.tra ?? '?'] ?? 0) + 1;
  writeStable(API_PATH, sanitizeRecord({
    generatedAt: nowIso,
    source: 'DfT D-TRO service (statutory digital traffic regulation orders), Greater London search, bus-relevant orders',
    note,
    count: list.length,
    totalOrders: Object.keys(acc.orders).length,
    publishingAuthorities: tras,
    orders: list,
  }));
  console.log(`Wrote ${list.length} bus-relevant orders (${Object.keys(acc.orders).length} total, ${Object.keys(tras).length} authorities)`);
}

/* ── Self-test: run the transform over committed fixtures ───────────────── */
function selftest() {
  const dir = path.join(ROOT, 'tests', 'fixtures', 'dtro');
  const geoms = loadRouteGeometries();
  let fail = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const o = extractOrder(f, doc, { troName: f }, geoms);
    const places = o.provisions.reduce((n, p) => n + p.places.length, 0);
    const withCoords = o.provisions.reduce((n, p) => n + p.places.filter(pl => pl.coords).length, 0);
    console.log(`  ${f}: provisions=${o.provisions.length} places=${places} coords=${withCoords} busRelevant=${o.busRelevant} routes=[${o.routes.join(',')}]`);
    if (!o.provisions.length || !withCoords) { console.error(`    FAIL: expected provisions with coordinates`); fail++; }
    if (f.startsWith('synthetic') && !o.routes.length) { console.error(`    FAIL: London fixture must corridor-join to routes`); fail++; }
  }
  if (fail) process.exit(1);
  console.log('Self-test passed.');
}

/* ── Main ───────────────────────────────────────────────────────────────── */
async function main() {
  if (process.argv.includes('--selftest')) return selftest();

  const appId = process.env.DTRO_CLIENT_ID, key = process.env.DTRO_API_KEY, secret = process.env.DTRO_CLIENT_SECRET;
  if (!appId || !key || !secret) {
    console.log('DTRO_CLIENT_ID / DTRO_API_KEY / DTRO_CLIENT_SECRET not set — skipped (last-known-good stays).');
    return;
  }

  const acc = loadAcc();
  const geoms = loadRouteGeometries();
  let token;
  try { token = await getToken(key, secret); }
  catch (e) { console.error(`D-TRO auth failed — ${e.message}. Keeping last-known-good.`); return; }
  console.log('Authenticated with the D-TRO service.');

  // Search Greater London. While the service is small (hundreds of London
  // orders ≈ a dozen search pages) a FULL search every run is cheap and
  // self-healing: an order whose detail fetch failed on a previous run is
  // simply not in the accumulator yet, so it gets retried, and unchanged
  // orders are skipped by the lastUpdated check below. The publicationTime
  // watermark only kicks in once the accumulator is big enough that paging
  // everything would matter (autumn-2026 mandate volumes).
  const query = { geometry: LONDON_POLY };
  const incremental = Object.keys(acc.orders).length > 5000;
  if (incremental && acc.watermark) query.publicationTime = acc.watermark;
  const ids = new Map();                          // id → summary meta
  let totalCount = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    try {
      res = await api('/search', token, appId, {
        method: 'POST',
        body: JSON.stringify({ page, pageSize: PAGE_SIZE, queries: [query] }),
      });
    } catch (e) {
      console.error(`search page ${page} failed — ${e.message}`);
      if (page === 1) { console.error('Keeping last-known-good.'); return; }
      break;                                       // partial haul still folds in
    }
    totalCount ??= res?.totalCount ?? null;
    const rows = res?.results ?? [];
    for (const r of rows) {
      if (!r?.id) continue;
      ids.set(r.id, {
        troName: r.troName ?? null,
        publicationTime: r.publicationTime ?? null,
        lastUpdated: r.lastUpdated ?? r.publicationTime ?? null,
        trafficAuthorityOwnerId: r.trafficAuthorityOwnerId ?? null,
      });
    }
    if (!rows.length || rows.length < PAGE_SIZE) break;
  }
  console.log(`Search: ${ids.size} orders in the London polygon${acc.watermark ? ` since ${acc.watermark}` : ''} (service total: ${totalCount ?? '?'})`);

  // Fetch full documents for new/changed orders (bounded per run).
  let fetched = 0, kept = 0, failures = 0;
  const prevWatermark = acc.watermark;
  for (const [id, meta] of ids) {
    const prev = acc.orders[id];
    if (prev && prev.lastUpdated === meta.lastUpdated) continue;
    if (fetched >= MAX_DETAIL) { console.log(`Detail cap ${MAX_DETAIL} reached — the rest picks up next run.`); break; }
    fetched++;
    try {
      const doc = await api(`/dtros/${id}`, token, appId);
      const order = extractOrder(id, doc?.data ? doc : { data: doc }, {
        ...meta, traName: doc?.traName ?? null,
        lastUpdated: doc?.lastUpdated ?? meta.lastUpdated,
      }, geoms);
      acc.orders[id] = order;
      if (order.busRelevant) kept++;
      // Watermark only advances over orders we actually hold — a failed
      // fetch must stay reachable by the next incremental search.
      const t = meta.publicationTime;
      if (t && (!acc.watermark || t > acc.watermark)) acc.watermark = t;
    } catch (e) {
      failures++;
      if (failures <= 3) console.warn(`  order ${id}: ${e.message}`);
    }
  }
  if (failures) acc.watermark = prevWatermark;   // failed orders must stay reachable next run
  console.log(`Fetched ${fetched} order documents (${kept} bus-relevant, ${failures} failures)`);

  writeOutputs(acc, 'Coverage grows as TRAs onboard — publication is mandatory for new orders from autumn 2026.');
}

main().catch(e => { console.error(e); process.exit(1); });
