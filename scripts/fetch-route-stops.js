import { sanitizeRecord } from './_lib/sanitize.js';
/**
 * fetch-route-stops.js — Per-route stop lists (TfL Route/Sequence canonical)
 *
 * For every bus route, /Line/{id}/Route/Sequence/{outbound,inbound} is the
 * canonical served sequence (ordered, per-direction, with stop letters and
 * the lines calling at each stop). /Line/{id}/StopPoints is called once per
 * route purely as enrichment — it is the only source of `towards` and the
 * full "Stop X" indicator text. Three files come out:
 *
 *   data/route_stops.json — per-route stop list (canonical order):
 *     { generated_at_utc, route_count,
 *       routes: { "1": [{ id: "490000001N", towards: "Hampstead" }, ...] } }
 *
 *   data/stops.json — canonical stop registry + reverse index:
 *     { generated_at_utc, stop_count,
 *       stops: { "490000001N": { name, indicator, lat, lon, routes: ["1","2"] } } }
 *
 *   data/api/route-stops.json — the served (v2) contract:
 *     { generatedAt, routes: { "1": {
 *         outbound: [{ id, name, lat, lng, lines: ["1","24"], letter: "D" }],
 *         inbound:  [...] } } }
 *
 * No diversion freeze is needed here: unlike /StopPoints (a loose
 * association list that accumulates diversion-path stops), Route/Sequence
 * reflects the registered timetable baseline, which temporary roadworks
 * diversions do not alter.
 *
 * Run: npm run fetch-route-stops
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './_lib/env.js';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ROUTE_STOPS_PATH = path.join(DATA_DIR, 'route_stops.json');
const STOPS_PATH = path.join(DATA_DIR, 'stops.json');
const API_ROUTE_STOPS_PATH = path.join(DATA_DIR, 'api', 'route-stops.json');
const BASE_URL = 'https://api.tfl.gov.uk';
const SCRIPT = 'route-stops';

loadEnv();
const API_KEY = process.env.BUS_API_KEY ?? '';
if (!API_KEY) console.warn('Warning: BUS_API_KEY not set — requests may be rate-limited');

function apiUrl(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${BASE_URL}${endpoint}${API_KEY ? `${sep}app_key=${API_KEY}` : ''}`;
}

async function fetchJson(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: userAgentHeaders(SCRIPT) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
}

// ── Concurrency helper with pacing ───────────────────────────────────────────
async function batchRun(items, fn, concurrency = 4, ratePerMin = 300) {
  const minInterval = ratePerMin > 0 ? Math.ceil(60_000 / ratePerMin) : 0;
  let idx = 0, nextSlot = Date.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      if (minInterval > 0) {
        const now = Date.now();
        const wait = nextSlot - now;
        nextSlot = Math.max(now, nextSlot) + minInterval;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371e3, D = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * D / 2) ** 2
    + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin((lon2 - lon1) * D / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Flatten one direction of a Route/Sequence response into an ordered,
 * deduped stop list. Branch sequences arrive in service order; most bus
 * routes have a single branch, loop/branch routes stitch in first-seen
 * order which matches how the sequence is presented.
 */
function flattenSequence(seq) {
  const out = [];
  const seen = new Set();
  for (const branch of seq?.stopPointSequences ?? []) {
    for (const s of branch?.stopPoint ?? []) {
      const id = String(s?.id ?? s?.stationId ?? '').trim();
      const lat = Number(s?.lat), lon = Number(s?.lon);
      if (!id || seen.has(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      seen.add(id);
      out.push({
        id,
        name: String(s?.name ?? 'Stop').trim() || 'Stop',
        lat: round5(lat),
        lng: round5(lon),
        lines: [...new Set((s?.lines ?? []).map(l => String(l?.name ?? l?.id ?? '').toUpperCase()).filter(Boolean))].sort(),
        letter: s?.stopLetter ? String(s.stopLetter).trim() : null,
        towards: s?.towards ? String(s.towards).trim() : null,
      });
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching bus line list from TfL...');
  const lines = await fetchJson(apiUrl('/Line/Mode/bus'));
  let routeIds = [...new Set(lines.map(l => String(l.id).toUpperCase()))].sort();
  console.log(`  ${routeIds.length} routes found`);

  // Debug aid: ONLY_ROUTES=88,24 node scripts/fetch-route-stops.js — skips
  // the validation gate and processes just those routes (nothing merged out).
  const only = (process.env.ONLY_ROUTES ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (only.length) routeIds = routeIds.filter(id => only.includes(id));

  /** @type {Record<string, Array<{id: string, towards?: string}>>} */
  const routeStops = {};
  /** @type {Record<string, {outbound: any[], inbound: any[]}>} */
  const apiRoutes = {};
  /** @type {Map<string, { name: string, indicator: string|null, lat: number, lon: number, routes: Set<string> }>} */
  const stopRegistry = new Map();
  const failed = [];
  let done = 0;

  await batchRun(routeIds, async (id) => {
    try {
      const enc = encodeURIComponent(id);
      const [outSeq, inSeq, stopPoints] = [
        await fetchJson(apiUrl(`/Line/${enc}/Route/Sequence/outbound?serviceTypes=Regular,Night`)).catch(() => null),
        await fetchJson(apiUrl(`/Line/${enc}/Route/Sequence/inbound?serviceTypes=Regular,Night`)).catch(() => null),
        await fetchJson(apiUrl(`/Line/${enc}/StopPoints`)).catch(() => null),
      ];

      const outbound = flattenSequence(outSeq);
      const inbound = flattenSequence(inSeq);
      if (!outbound.length && !inbound.length) { failed.push(id); return; }

      // Enrichment index: naptan → { towards, indicator } from /StopPoints —
      // the only endpoint that carries them reliably.
      const enrich = new Map();
      const spList = Array.isArray(stopPoints) ? stopPoints : (stopPoints?.value ?? []);
      for (const s of spList) {
        const naptan = String(s?.naptanId ?? '').trim();
        if (!naptan) continue;
        const towardsRaw = Array.isArray(s?.additionalProperties)
          ? s.additionalProperties.find(p => p?.key === 'Towards')?.value
          : null;
        enrich.set(naptan, {
          towards: towardsRaw ? String(towardsRaw).trim() : null,
          indicator: s?.indicator ? String(s.indicator).trim() : null,
        });
      }

      apiRoutes[id] = {
        outbound: outbound.map(({ towards, ...s }) => s),
        inbound: inbound.map(({ towards, ...s }) => s),
      };

      // v1 list: outbound order, then inbound-only stops appended.
      const seen = new Set();
      const stopsForRoute = [];
      for (const s of [...outbound, ...inbound]) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        const e = enrich.get(s.id) ?? {};
        const towards = e.towards ?? s.towards ?? null;
        stopsForRoute.push(towards ? { id: s.id, towards } : { id: s.id });

        let entry = stopRegistry.get(s.id);
        if (!entry) {
          entry = {
            name: s.name,
            indicator: e.indicator ?? (s.letter ? `Stop ${s.letter}` : null),
            lat: round6(s.lat),
            lon: round6(s.lng),
            routes: new Set(),
          };
          stopRegistry.set(s.id, entry);
        }
        entry.routes.add(id);
      }
      routeStops[id] = stopsForRoute;
    } catch (err) {
      failed.push(id);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${routeIds.length}`);
  }, 4, 150);   // 3 HTTP calls per route → ~450 req/min ceiling, under TfL's 500

  // Last-known-good merge: a route whose fetch failed (or that is frozen for
  // a diversion) keeps its previous entry rather than vanishing from the
  // output — on 2026-07-27 a burst of TfL 429s silently dropped 8 routes
  // (18, 177–183) and their stops from both files. Only routes still in
  // TfL's line list are restored (`failed`), so a genuinely withdrawn
  // route still drops out. Registry entries merge back the same way.
  try {
    const prevRS = JSON.parse(fs.readFileSync(ROUTE_STOPS_PATH, 'utf8'))?.routes ?? {};
    const prevST = JSON.parse(fs.readFileSync(STOPS_PATH, 'utf8'))?.stops ?? {};
    const failedSet = new Set(failed);
    const restored = [];
    for (const [id, entries] of Object.entries(prevRS)) {
      if (!failedSet.has(id)) continue;
      if (routeStops[id] || !Array.isArray(entries) || !entries.length) continue;
      routeStops[id] = entries;
      restored.push(id);
      for (const e of entries) {
        const os = prevST[e?.id];
        if (!os) continue;
        let reg = stopRegistry.get(e.id);
        if (!reg) {
          reg = { name: os.name, indicator: os.indicator ?? null, lat: os.lat, lon: os.lon, routes: new Set() };
          stopRegistry.set(e.id, reg);
        }
        reg.routes.add(id);
      }
    }
    if (restored.length) console.warn(`  kept last-known-good stops for ${restored.length} routes: ${restored.join(', ')}`);
  } catch { /* no previous files (cold start) — nothing to merge */ }

  // Same merge for the served per-direction file.
  try {
    const prevAPI = JSON.parse(fs.readFileSync(API_ROUTE_STOPS_PATH, 'utf8'))?.routes ?? {};
    const failedSet = new Set(failed);
    for (const [id, rec] of Object.entries(prevAPI)) {
      const key = id.toUpperCase();
      if (!failedSet.has(key) || apiRoutes[key]) continue;
      apiRoutes[key] = rec;
    }
  } catch { /* cold start */ }

  // Spatial sanity gate: drop any stop further than MAX_STOP_DIST_M from the
  // route's own geometry. TfL occasionally includes a wrong stop-area
  // record — e.g. W13 and N55 both listed 490G000679 "Mulberry Circus"
  // (Barking, ~9 km from either route), and route 344 carried a group
  // 13.9 km off. A stop that far from every point of the line cannot be
  // served by it. The 2 km threshold clears the real outlier class
  // (2.4–13.9 km) while keeping the ~1.6 km tail of stops on freshly
  // rerouted sections whose geometry ZIP hasn't caught up yet.
  const MAX_STOP_DIST_M = 2000;
  const dropped = [];
  for (const [id, entries] of Object.entries(routeStops)) {
    let pts = null;
    try {
      const gj = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'routes', `${id}.geojson`), 'utf8'));
      pts = [];
      for (const f of gj.features ?? []) {
        const segs = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
        for (const seg of segs) for (let i = 0; i < seg.length; i += 3) pts.push(seg[i]);
      }
    } catch { /* no geometry for this route — keep all stops */ }
    if (!pts || !pts.length) continue;

    const farFromLine = (lat, lon) => {
      let min = Infinity;
      for (const [plon, plat] of pts) {
        const d = haversineM(lat, lon, plat, plon);
        if (d < min) min = d;
        if (min <= MAX_STOP_DIST_M) return false;
      }
      return true;
    };

    routeStops[id] = entries.filter(e => {
      const s = stopRegistry.get(e.id);
      if (!s) return true;
      if (!farFromLine(s.lat, s.lon)) return true;
      s.routes.delete(id);
      dropped.push(`${id}:${e.id} ${s.name}`);
      return false;
    });
    if (apiRoutes[id]) {
      for (const dir of ['outbound', 'inbound']) {
        apiRoutes[id][dir] = (apiRoutes[id][dir] ?? []).filter(s => !farFromLine(s.lat, s.lng));
      }
    }
  }
  // Registry entries that lost their last route are gone too.
  for (const [naptan, s] of stopRegistry) if (s.routes.size === 0) stopRegistry.delete(naptan);
  if (dropped.length) console.warn(`  dropped ${dropped.length} stops >${MAX_STOP_DIST_M} m from their route: ${dropped.join(', ')}`);

  // Sort routes + stops for deterministic output
  const sortedRoutes = {};
  for (const k of Object.keys(routeStops).sort()) sortedRoutes[k] = routeStops[k];

  const sortedApiRoutes = {};
  for (const k of Object.keys(apiRoutes).sort()) sortedApiRoutes[k] = apiRoutes[k];

  const sortedStops = {};
  for (const k of [...stopRegistry.keys()].sort()) {
    const e = stopRegistry.get(k);
    sortedStops[k] = {
      name: e.name,
      indicator: e.indicator,
      lat: e.lat,
      lon: e.lon,
      routes: [...e.routes].sort(),
    };
  }

  // Validation gate: refuse to write an implausibly thin result — better to
  // serve yesterday's stops than half of today's.
  const routeCount = Object.keys(sortedRoutes).length;
  const stopCount = Object.keys(sortedStops).length;
  if (!only.length && (routeCount < 500 || stopCount < 15000)) {
    console.error(`Validation failed: ${routeCount} routes / ${stopCount} stops (need ≥500 / ≥15000) — nothing written`);
    process.exit(1);
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(API_ROUTE_STOPS_PATH), { recursive: true });
  fs.writeFileSync(
    ROUTE_STOPS_PATH,
    JSON.stringify({
      generated_at_utc: now,
      route_count: routeCount,
      routes: sortedRoutes,
    }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    STOPS_PATH,
    JSON.stringify({
      generated_at_utc: now,
      stop_count: stopCount,
      stops: sortedStops,
    }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    API_ROUTE_STOPS_PATH,
    JSON.stringify({ generatedAt: now, routes: sortedApiRoutes }) + '\n',
    'utf8'
  );

  console.log(`Wrote ${routeCount} routes → ${ROUTE_STOPS_PATH}`);
  console.log(`Wrote ${stopCount} unique stops → ${STOPS_PATH}`);
  console.log(`Wrote ${Object.keys(sortedApiRoutes).length} routes → ${API_ROUTE_STOPS_PATH}`);
  if (failed.length) console.warn(`  ${failed.length} routes kept last-known-good: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? '…' : ''}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
