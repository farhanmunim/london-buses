import { sanitizeRecord } from './_lib/sanitize.js';
/**
 * fetch-route-stops.js — Per-route stop lists (TfL API)
 *
 * Calls /Line/{id}/StopPoints for every bus route and produces two files:
 *
 *   data/route_stops.json — per-route stop list (ordered as TfL returns):
 *     { generated_at_utc, route_count,
 *       routes: { "1": [{ id: "490000001N", towards: "Hampstead" }, ...] } }
 *
 *   data/stops.json — canonical stop registry + reverse index:
 *     { generated_at_utc, stop_count,
 *       stops: { "490000001N": { name, indicator, lat, lon, routes: ["1","2"] } } }
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

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371e3, D = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * D / 2) ** 2
    + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin((lon2 - lon1) * D / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching bus line list from TfL...');
  const lines = await fetchJson(apiUrl('/Line/Mode/bus'));
  const routeIds = [...new Set(lines.map(l => String(l.id).toUpperCase()))].sort();
  console.log(`  ${routeIds.length} routes found`);

  /** @type {Record<string, string[]>} */
  const routeStops = {};
  /** @type {Map<string, { name: string, indicator: string|null, lat: number, lon: number, routes: Set<string> }>} */
  const stopRegistry = new Map();
  const failed = [];
  let done = 0;

  await batchRun(routeIds, async (id) => {
    try {
      const data = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/StopPoints`));
      const stops = Array.isArray(data) ? data : (data?.value ?? []);

      const stopsForRoute = [];
      const seen = new Set();
      for (const s of stops) {
        const naptan = String(s?.naptanId ?? '').trim();
        const lat = Number(s?.lat);
        const lon = Number(s?.lon);
        if (!naptan || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (seen.has(naptan)) continue;
        seen.add(naptan);

        const towardsRaw = Array.isArray(s?.additionalProperties)
          ? s.additionalProperties.find(p => p?.key === 'Towards')?.value
          : null;
        const towards = towardsRaw ? String(towardsRaw).trim() : null;
        stopsForRoute.push(towards ? { id: naptan, towards } : { id: naptan });

        let entry = stopRegistry.get(naptan);
        if (!entry) {
          entry = {
            name: String(s?.commonName ?? 'Stop').trim() || 'Stop',
            indicator: s?.indicator ? String(s.indicator).trim() : null,
            lat: round6(lat),
            lon: round6(lon),
            routes: new Set(),
          };
          stopRegistry.set(naptan, entry);
        }
        entry.routes.add(id);
      }

      if (stopsForRoute.length) routeStops[id] = stopsForRoute;
      else failed.push(id);
    } catch (err) {
      failed.push(id);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${routeIds.length}`);
  }, 4, 300);

  // Last-known-good merge: a route whose /StopPoints call failed (or came
  // back empty) keeps its previous entry rather than vanishing from the
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

  // Spatial sanity gate: drop any stop further than MAX_STOP_DIST_M from the
  // route's own geometry. TfL's /Line/{id}/StopPoints occasionally includes a
  // wrong stop-area record — e.g. W13 and N55 both list 490G000679 "Mulberry
  // Circus" (Barking, ~9 km from either route), and route 344 carried a
  // group 13.9 km off. A stop that far from every point of the line cannot
  // be served by it. The 2 km threshold clears the real outlier class
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

    routeStops[id] = entries.filter(e => {
      const s = stopRegistry.get(e.id);
      if (!s) return true;
      let min = Infinity;
      for (const [lon, lat] of pts) {
        const d = haversineM(s.lat, s.lon, lat, lon);
        if (d < min) min = d;
        if (min <= MAX_STOP_DIST_M) break;
      }
      if (min <= MAX_STOP_DIST_M) return true;
      s.routes.delete(id);
      dropped.push(`${id}:${e.id} ${s.name} (${Math.round(min)} m)`);
      return false;
    });
  }
  // Registry entries that lost their last route are gone too.
  for (const [naptan, s] of stopRegistry) if (s.routes.size === 0) stopRegistry.delete(naptan);
  if (dropped.length) console.warn(`  dropped ${dropped.length} stops >${MAX_STOP_DIST_M} m from their route: ${dropped.join(', ')}`);

  // Sort routes + stops for deterministic output
  const sortedRoutes = {};
  for (const k of Object.keys(routeStops).sort()) sortedRoutes[k] = routeStops[k];

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

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    ROUTE_STOPS_PATH,
    JSON.stringify({
      generated_at_utc: now,
      route_count: Object.keys(sortedRoutes).length,
      routes: sortedRoutes,
    }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    STOPS_PATH,
    JSON.stringify({
      generated_at_utc: now,
      stop_count: Object.keys(sortedStops).length,
      stops: sortedStops,
    }, null, 2) + '\n',
    'utf8'
  );

  console.log(`Wrote ${Object.keys(sortedRoutes).length} routes → ${ROUTE_STOPS_PATH}`);
  console.log(`Wrote ${Object.keys(sortedStops).length} unique stops → ${STOPS_PATH}`);
  if (failed.length) console.warn(`  ${failed.length} routes returned no stops: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? '…' : ''}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
