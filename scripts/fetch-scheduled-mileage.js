/**
 * fetch-scheduled-mileage.js — Daily SCHEDULED mileage per route.
 *
 * Why: TfL publishes operated-vs-scheduled mileage per route only at
 * 4-week-period granularity (the per-route QSI PDFs); no public source
 * carries daily figures. This script derives the daily SCHEDULED side to
 * high accuracy from two sources we already trust:
 *
 *   trips/day  — TfL Unified API /Line/{id}/Timetable/{firstStop}?direction=…
 *                per direction, counting knownJourneys per day type
 *                (weekday / saturday / sunday, using the same schedule-name
 *                classifier as fetch-frequencies.js);
 *   km/trip    — per-direction geometry length from data/routes/<id>.geojson
 *                (haversine; for MultiLineString directions the LONGEST run
 *                is the canonical trip — the shorter runs are LBSL variant
 *                workings whose inclusion would overcount).
 *
 *   dailyKm[dayType] = Σ over directions (trips × km/trip)
 *
 * This is an estimate, clearly labelled: short workings scheduled to turn
 * early are counted at full route length, and school-day-only variants are
 * folded into 'weekday'. Cross-checks against TfL's annual scheduled-km
 * totals put route-level error typically inside a few percent — good
 * enough to size lost mileage against, not an operating record.
 *
 * The ACTUAL operated side stays TfL's own per-period figure
 * (fetch-route-performance.js) — daily operated mileage cannot be honestly
 * produced without continuous vehicle tracking, which this platform
 * deliberately does not do.
 *
 * Output: data/api/scheduled-mileage.json
 *   { generatedAt, source, method, count, routes: { "<id>": {
 *       kmOutbound, kmInbound,
 *       trips:   { weekday:{outbound,inbound}, saturday:{…}, sunday:{…} },
 *       dailyKm: { weekday, saturday, sunday } } } }
 *
 * Run: npm run fetch-scheduled-mileage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './_lib/env.js';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'api', 'scheduled-mileage.json');
const BASE_URL  = 'https://api.tfl.gov.uk';
const SCRIPT    = 'scheduled-mileage';

loadEnv();
const API_KEY = process.env.BUS_API_KEY ?? '';
const apiUrl = (ep) => `${BASE_URL}${ep}${API_KEY ? `${ep.includes('?') ? '&' : '?'}app_key=${API_KEY}` : ''}`;

async function fetchJson(url, retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      const r = await fetchWithTimeout(url, { headers: userAgentHeaders(SCRIPT) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (i === retries) return undefined;           // distinct from 404
      await new Promise(res => setTimeout(res, i * 1200));
    }
  }
}

// Schedule-name → day-type classifier. Extends fetch-frequencies.js's
// rules with night-service names: a schedule called "Friday Night/Saturday
// Morning" RUNS on Friday night, so it belongs to the weekday bucket (the
// generic /sat/ rule would misfile it), and TfL abbreviates to "Mo-Th
// Nights/Tu-Fr Morning" which none of the long-form patterns match.
function classifyScheduleName(name) {
  if (/fri(day)?\s*night/.test(name))        return 'weekday';
  if (/sat(urday)?\s*night/.test(name))      return 'saturday';
  if (/sun(day)?\s*night/.test(name))        return 'sunday';
  if (/mo-th/.test(name))                    return 'weekday';
  if (/mon/.test(name) && /fri/.test(name))  return 'weekday';
  if (/mon/.test(name) && /thu/.test(name))  return 'weekday';
  if (/weekday/.test(name))                  return 'weekday';
  if (/sat/.test(name))                      return 'saturday';
  if (/sun/.test(name))                      return 'sunday';
  if (/fri/.test(name))                      return 'weekday';
  return null;
}

function tripsByDayType(timetable) {
  // Within one route variant, schedules classified to the same bucket are
  // ALTERNATIVE days of that type ("Monday to Thursday" 107 + "Friday" 107
  // = a 107-trip weekday, not 214) — take the max as the representative
  // day. Across variants (rare: different terminals sharing the origin
  // stop) journeys are additive — sum the per-variant representatives.
  const trips = { weekday: 0, saturday: 0, sunday: 0 };
  for (const rt of (timetable?.timetable?.routes ?? [])) {
    const perVariant = { weekday: 0, saturday: 0, sunday: 0 };
    for (const sch of (rt.schedules ?? [])) {
      const dt = classifyScheduleName((sch.name ?? '').toLowerCase());
      if (dt) perVariant[dt] = Math.max(perVariant[dt], (sch.knownJourneys ?? []).length);
    }
    for (const dt of ['weekday', 'saturday', 'sunday']) trips[dt] += perVariant[dt];
  }
  return trips;
}

// Haversine length (km) of the longest run of a direction's geometry.
const R = 6371;
function segKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1], [lon2, lat2] = coords[i];
    const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    km += 2 * R * Math.asin(Math.sqrt(a));
  }
  return km;
}
function directionKm(routeId) {
  let gj;
  try { gj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', `${routeId}.geojson`), 'utf8')); }
  catch { return {}; }
  const out = {};
  for (const f of (gj.features ?? [])) {
    const dir = String(f.properties?.direction ?? '');
    const g = f.geometry;
    const runs = g?.type === 'LineString' ? [g.coordinates]
               : g?.type === 'MultiLineString' ? g.coordinates : [];
    const longest = Math.max(0, ...runs.map(segKm));
    // TfL geometry direction 1 = outbound, 2 = inbound.
    const name = dir === '1' ? 'outbound' : dir === '2' ? 'inbound' : dir;
    out[name] = Math.round(longest * 100) / 100;
  }
  return out;
}

async function batchRun(items, fn, concurrency, ratePerMin) {
  const minInterval = ratePerMin > 0 ? Math.ceil(60_000 / ratePerMin) : 0;
  let idx = 0, nextSlot = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      if (minInterval > 0) {
        const now = Date.now(), wait = nextSlot - now;
        nextSlot = Math.max(now, nextSlot) + minInterval;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      await fn(items[i], i);
    }
  }));
}

async function main() {
  const routeStops = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'api', 'route-stops.json'), 'utf8'));
  const ids = Object.keys(routeStops.routes ?? routeStops).sort();
  console.log(`${ids.length} routes`);

  // Keep last-known-good per route so a flaky timetable call doesn't wipe
  // an entry between runs.
  let prevRoutes = {};
  try { prevRoutes = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).routes ?? {}; } catch { /* first run */ }

  const routes = {};
  let done = 0, failed = 0;
  await batchRun(ids, async (id) => {
    const rs = (routeStops.routes ?? routeStops)[id] ?? {};
    const km = directionKm(id);
    const trips = {};
    let anyFail = false;
    for (const dir of ['outbound', 'inbound']) {
      const seq = rs[dir] ?? [];
      const first = seq[0] && (typeof seq[0] === 'string' ? seq[0] : seq[0].id ?? seq[0].naptanId);
      if (!first || !km[dir]) continue;
      const tt = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/Timetable/${encodeURIComponent(first)}?direction=${dir}`));
      if (tt === undefined) { anyFail = true; continue; }
      if (!tt) continue;                             // 404: no timetable this direction
      const t = tripsByDayType(tt);
      for (const dt of ['weekday', 'saturday', 'sunday']) {
        (trips[dt] ??= {})[dir] = t[dt];
      }
    }
    const hasData = Object.values(trips).some(d => (d.outbound ?? 0) + (d.inbound ?? 0) > 0);
    if (hasData) {
      const dailyKm = {};
      for (const dt of ['weekday', 'saturday', 'sunday']) {
        const t = trips[dt] ?? {};
        const v = (t.outbound ?? 0) * (km.outbound ?? 0) + (t.inbound ?? 0) * (km.inbound ?? 0);
        dailyKm[dt] = Math.round(v * 10) / 10;
      }
      routes[id] = {
        kmOutbound: km.outbound ?? null,
        kmInbound:  km.inbound ?? null,
        trips, dailyKm,
      };
    } else if (prevRoutes[id] && (anyFail || !hasData)) {
      routes[id] = prevRoutes[id];                   // last known good
      if (anyFail) failed++;
    }
    if (++done % 50 === 0) console.log(`  ${done}/${ids.length}`);
  }, 3, API_KEY ? 300 : 45);

  const payload = sanitizeRecord({
    generatedAt: new Date().toISOString(),
    source: 'TfL Unified API /Line/{id}/Timetable per direction × per-direction geometry length',
    method: 'dailyKm[dayType] = trips × longest-run haversine km per direction; short workings counted at full length (estimate, labelled)',
    count: Object.keys(routes).length,
    routes: Object.fromEntries(Object.keys(routes).sort().map(k => [k, routes[k]])),
  });
  const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch { /* first run */ }
  if (!prev || stable(prev) !== stable(payload)) {
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');
  }
  console.log(`Wrote ${payload.count} routes (${failed} kept last-known-good after fetch failures)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
