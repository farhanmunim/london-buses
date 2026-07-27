/**
 * api.js – Data access layer
 *
 * Two sources, one shape:
 *   • The Atlas public API (atlas.farhan.app/api/v1 — same author, same
 *     upstream warehouse; CORS-open, read-only, no key) is the primary
 *     source for every dataset it serves at UI fidelity: garages (merged
 *     join-safely with the bundled record — see fetchGarageLocations),
 *     tender awards, and the per-route reliability, route-meta and fleet
 *     blocks (overlaid onto the classifications — see
 *     fetchRouteClassifications). Responses are adapted to the
 *     bundled-file shapes so nothing downstream changes, and the committed
 *     /data files remain the automatic fallback when the API is
 *     unreachable.
 *   • The rest still loads from the static GeoJSON/JSON committed by the
 *     weekly refresh, because the API does not yet serve it at the
 *     fidelity the UI needs (verified 2026-07-27):
 *       – per-route geometry: /routes/{id}/geometry answers with the route
 *         list (catch-all), and the warehouse's route_geometry table is
 *         only published inside transit.db;
 *       – overview layer: /routes-overview features lack the paint/filter
 *         properties (operator, propulsion, deck, frequency, lengthBand,
 *         isPrefix);
 *       – stops: /route-stops has no `indicator`, no `towards`, and each
 *         stop's `lines` lists only the queried route, not all routes
 *         serving the stop;
 *       – destinations: no endpoint;
 *       – deck / frequency / lengthBand / next-tender programme: absent
 *         from every endpoint.
 *     Each of those moves API-first as soon as Atlas closes the gap.
 * All responses are cached in memory for the session.
 */

const BASE    = './data';

// Remote data API. Override via `globalThis.LB_API_BASE` before module load
// (e.g. to point a preview build at a staging API).
const API_BASE = globalThis.LB_API_BASE ?? 'https://atlas.farhan.app/api/v1';

// In-memory cache
const _cache = new Map();

async function loadJson(path) {
  if (_cache.has(path)) return _cache.get(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  const data = await res.json();
  _cache.set(path, data);
  return data;
}

/** Fetch a data-API endpoint; resolves null (with a console.warn) when unavailable. */
async function loadApi(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`API ${path} unavailable (${err.message}); using bundled data`);
    return null;
  }
}

/**
 * Returns the GeoJSON FeatureCollection for a route.
 * Features have properties: { routeId, direction ('1'|'2'), sourceDate }
 * Geometry is LineString or MultiLineString.
 *
 * @param {string} routeId  e.g. '25', 'N25', 'X26'
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function fetchRouteGeoJson(routeId) {
  return loadJson(`${BASE}/routes/${routeId.toUpperCase()}.geojson`);
}

/**
 * Returns the flat list of all known route IDs from the index.
 * @returns {Promise<string[]>}
 */
export async function fetchRouteIndex() {
  const index = await loadJson(`${BASE}/routes/index.json`);
  return index.routes ?? [];
}

/**
 * Returns the full route_destinations map (all routes at once).
 * Keys are normalised to uppercase.
 * @returns {Promise<object>} { routeId: { inbound, outbound, service_types } }
 */
export async function fetchAllDestinations() {
  const data = await loadJson(`${BASE}/route_destinations.json`);
  // Normalise all keys to uppercase so lookups always succeed regardless of
  // how the build script stored them (TfL API returns lowercase IDs).
  const raw = data.routes ?? {};
  const normalised = {};
  for (const [k, v] of Object.entries(raw)) normalised[k.toUpperCase()] = v;
  return normalised;
}

/**
 * Returns the route classifications map — the master per-route record built
 * by the weekly pipeline — with three Atlas overlays applied per route:
 *
 *   /route-performance — the reliability block (serviceClass, EWT / OTP
 *   actuals, MPS standards). Both sides parse the same TfL QSI
 *   publications, but the API re-checks daily, so the overlay is never
 *   staler than the committed build.
 *
 *   /route-meta — daily re-parse of the same londonbusroutes.net source
 *   the weekly build reads. Shared-vocabulary fields (garage code + name,
 *   PVR) take the API value when present. Fields the build normalises —
 *   operator (parent-brand vocabulary that stats.js / garage-filter.js
 *   join on), vehicleType (fleet-string cleanup), contract dates (format
 *   differs) — and DVLA-derived propulsion only fill bundled nulls:
 *   overlaying the API's raw strings would break those joins.
 *
 *   /fleet — today's arrivals sample enriched via DVLA. The bundled
 *   aggregates come from weeks of accumulated, recurrence-filtered
 *   observations, so a one-day sample only fills routes the build has no
 *   answer for (make, age, size, composition, propulsion), and marks them
 *   fleetConfidence 'low'.
 *
 * When the API is unreachable the committed values stand.
 * @returns {Promise<object>}
 */
export async function fetchRouteClassifications() {
  const key = 'adapted:classifications';
  if (_cache.has(key)) return _cache.get(key);

  const [data, perf, meta, fleet] = await Promise.all([
    loadJson(`${BASE}/route_classifications.json`),
    loadApiCached('/route-performance'),
    loadApiCached('/route-meta'),
    loadApiCached('/fleet'),
  ]);

  // Per-record clones: the overlays below write into the records, and the
  // originals are shared via loadJson's cache with direct readers of the
  // bundled file (fetchGarageLocations).
  const routes = Object.fromEntries(
    Object.entries(data.routes ?? {}).map(([k, v]) => [k, { ...v }]),
  );
  for (const [id, p] of Object.entries(perf?.routes ?? {})) {
    const routeId = id.toUpperCase();
    const rec = routes[routeId];
    // Take the API's reliability block whole (nulls included) so the
    // class/metric pairing stays coherent — the build nulls the wrong-class
    // metric deliberately, and a field-by-field merge could resurrect it.
    if (!rec || !p?.serviceClass) continue;
    routes[routeId] = {
      ...rec,
      serviceClass:  p.serviceClass,
      ewtMinutes:    p.ewtMinutes    ?? null,
      onTimePercent: p.onTimePercent ?? null,
      ewtMps:        p.ewtMps        ?? null,
      otpMps:        p.otpMps        ?? null,
      mileageMps:    p.mileageMps    ?? null,
    };
  }

  for (const [id, m] of Object.entries(meta?.routes ?? {})) {
    const rec = routes[id.toUpperCase()];
    if (!rec || typeof m !== 'object' || m === null) continue;
    if (m.garage)                 { rec.garageCode = m.garage; rec.garageName = m.garageName ?? rec.garageName; }
    if (Number.isFinite(m.pvr))     rec.pvr = m.pvr;
    if (rec.operator    == null && m.operator)    rec.operator    = m.operator;
    if (rec.vehicleType == null && m.fleet)       rec.vehicleType = m.fleet;
    if (rec.propulsion  == null && m.propulsion)  rec.propulsion  = m.propulsion;
  }

  for (const [id, f] of Object.entries(fleet?.byRoute ?? {})) {
    const rec = routes[id.toUpperCase()];
    if (!rec || !(f?.enriched > 0)) continue;
    let filled = false;
    if (rec.make == null && f.makes?.[0]?.make) {
      rec.make = f.makes[0].make.toUpperCase();
      filled = true;
    }
    if (rec.vehicleAgeYears == null && Number.isFinite(f.avgAgeYears)) {
      rec.vehicleAgeYears = f.avgAgeYears;
      filled = true;
    }
    if (rec.fleetSize == null && Number.isFinite(f.count) && f.count > 0) {
      rec.fleetSize = f.count;
      filled = true;
    }
    if (rec.fleetComposition == null && f.makes?.length) {
      const total = f.makes.reduce((n, x) => n + (x.n ?? 0), 0);
      if (total > 0) {
        rec.fleetComposition = f.makes.map(x => ({
          make:  String(x.make ?? '').toUpperCase(),
          count: x.n ?? 0,
          share: (x.n ?? 0) / total,
        }));
        filled = true;
      }
    }
    if (rec.propulsion == null && f.propulsion) {
      const top = Object.entries(f.propulsion).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) { rec.propulsion = top[0]; filled = true; }
    }
    if (filled && rec.fleetConfidence == null) rec.fleetConfidence = 'low';
  }

  _cache.set(key, routes);
  return routes;
}

/**
 * Returns classification info for a single route (from the same merged map
 * as fetchRouteClassifications, so the reliability overlay applies here too).
 * @param {string} routeId
 * @returns {Promise<object|null>}
 */
export async function fetchRouteClassification(routeId) {
  const routes = await fetchRouteClassifications();
  return routes[routeId.toUpperCase()] ?? null;
}

/**
 * Returns destination info for a route.
 * Case-insensitive: handles both uppercase and lowercase keys in the data file.
 * @param {string} routeId
 * @returns {Promise<{inbound, outbound, service_types}|null>}
 */
export async function fetchRouteDestinations(routeId) {
  const data = await loadJson(`${BASE}/route_destinations.json`);
  const id   = routeId.toUpperCase();
  // Try uppercase first (new format), fall back to lowercase (legacy data)
  return data.routes?.[id] ?? data.routes?.[id.toLowerCase()] ?? null;
}

/**
 * Returns located garages: [{ code, name, operator, address, lat, lon, pvr,
 * capacity }, …]. Garages without a location are omitted.
 *
 * API-first with a join-safe merge: /garages refreshes the fields the API
 * carries (name, location, PVR, capacity) per garage code, while the bundled
 * garage-locations.json stays the base record — it supplies the street
 * address (the API only has a postcode), the operator names in the exact
 * vocabulary route_classifications.json joins on (stats.js and
 * garage-filter.js match operator by string), and any garage the API doesn't
 * list. API-only garages are added when route_classifications.json
 * references their code (operator derived from those routes); unreferenced
 * ones are skipped — they can't join to any route, so they'd render as
 * empty markers.
 */
export async function fetchGarageLocations() {
  const key = 'api:/garages';
  if (_cache.has(key)) return _cache.get(key);

  const [api, bundled, cls] = await Promise.all([
    loadApi('/garages'),
    loadJson(`${BASE}/garage-locations.json`).catch(err => {
      console.warn('garage-locations.json not available:', err.message);
      return null;
    }),
    loadJson(`${BASE}/route_classifications.json`).catch(() => null),
  ]);

  const garages = { ...(bundled?.garages ?? {}) };
  if (api) {
    // Majority operator per garage code, from the routes assigned to it —
    // keeps API-only garages in the same operator vocabulary as everything else.
    const opsByCode = {};
    for (const c of Object.values(cls?.routes ?? {})) {
      if (!c.garageCode || !c.operator) continue;
      const ops = (opsByCode[c.garageCode] ??= {});
      ops[c.operator] = (ops[c.operator] ?? 0) + 1;
    }
    for (const g of api.garages ?? []) {
      if (!g?.code) continue;
      const base   = garages[g.code];
      const clsOps = opsByCode[g.code];
      if (!base && !clsOps) continue; // depot no route here joins to — skip
      garages[g.code] = {
        code:     g.code,
        name:     g.name ?? base?.name ?? g.code,
        operator: base?.operator
                    ?? (clsOps && Object.entries(clsOps).sort((a, b) => b[1] - a[1])[0][0])
                    ?? g.operator ?? null,
        company:  g.company ?? null, // legal operating entity — API-only field
        address:  base?.address || g.postcode || '',
        lat:      g.lat ?? base?.lat ?? null,
        lon:      g.lng ?? base?.lon ?? null,
        pvr:      Number.isFinite(g.pvr)      ? g.pvr      : (base?.pvr      ?? null),
        capacity: Number.isFinite(g.capacity) ? g.capacity : (base?.capacity ?? null),
      };
    }
  }

  const list = Object.values(garages).filter(g => g.lat != null && g.lon != null);
  _cache.set(key, list);
  return list;
}

/**
 * Returns the canonical stops registry: stopId → { name, indicator, lat, lon, routes[] }.
 * Lazy-loaded on first call, then cached for the session.
 * @returns {Promise<Record<string, { name: string, indicator: string|null, lat: number, lon: number, routes: string[] }>>}
 */
export async function fetchStopsRegistry() {
  const payload = await loadJson(`${BASE}/stops.json`);
  return payload?.stops ?? {};
}

/**
 * Returns just the stop count for a route — cheap O(1) lookup once the
 * route_stops bundle is cached, so route cards can display "N stops"
 * without materialising the full stops GeoJSON array.
 * @param {string} routeId
 * @returns {Promise<number>}
 */
export async function fetchRouteStopCount(routeId) {
  const { routeStops } = await loadStopsBundle();
  return (routeStops[routeId.toUpperCase()] ?? []).length;
}

/**
 * Loads the stored stops registry + per-route stop lists once and caches them.
 * @returns {Promise<{ stops: Record<string, object>, routeStops: Record<string, object[]> }>}
 */
async function loadStopsBundle() {
  const [stopsPayload, routeStopsPayload] = await Promise.all([
    loadJson(`${BASE}/stops.json`),
    loadJson(`${BASE}/route_stops.json`),
  ]);
  return {
    stops:      stopsPayload?.stops ?? {},
    routeStops: routeStopsPayload?.routes ?? {},
  };
}

/**
 * Returns the stops for a route as GeoJSON Point features, read from the
 * weekly-refreshed static data files. Preserves the shape returned by the
 * previous live-TfL implementation so downstream callers don't change.
 * @param {string} routeId
 * @returns {Promise<object[]>} Array of GeoJSON-style feature objects
 */
export async function fetchStopsForRoute(routeId) {
  const id       = routeId.toUpperCase();
  const cacheKey = `stops:${id}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const { stops, routeStops } = await loadStopsBundle();
  const entries = routeStops[id] ?? [];

  const features = [];
  for (const entry of entries) {
    const stop = stops[entry.id];
    if (!stop) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
      properties: {
        id:        entry.id,
        name:      stop.name ?? 'Stop',
        indicator: stop.indicator ?? null,
        towards:   entry.towards ?? null,
        routes:    (stop.routes ?? []).map(r => r.toUpperCase()).sort().join(','),
      },
    });
  }

  _cache.set(cacheKey, features);
  return features;
}

const MONTHS = {
  january: '01', february: '02', march: '03',     april: '04',
  may: '05',     june: '06',     july: '07',      august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

/** "13 March 2003" (API format) → "2003-03-13" (bundled format — sorts chronologically). */
function toIsoDate(s) {
  const m  = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(String(s ?? '').trim());
  const mm = m && MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : (s ?? null);
}

/**
 * Adapts the API's /tenders payload ({ byId: { btID: { route, operator,
 * acceptedBid, … , awardDate } } }) to the bundled source/tenders.json shape
 * ({ tenders: { btID: { route_id, awarded_operator, accepted_bid, …,
 * award_announced_date } } }). `reason_not_lowest` is not exposed by the API,
 * so it's overlaid per btID from the bundled snapshot when that loaded.
 */
function adaptTenders(payload, local) {
  const tenders = {};
  for (const [btID, t] of Object.entries(payload?.byId ?? {})) {
    tenders[btID] = {
      route_id:             t.route ?? null,
      award_announced_date: toIsoDate(t.awardDate),
      awarded_operator:     t.operator ?? null,
      number_of_tenderers:  t.numberOfTenderers ?? null,
      accepted_bid:         t.acceptedBid ?? null,
      lowest_bid:           t.lowestBid ?? null,
      highest_bid:          t.highestBid ?? null,
      cost_per_mile:        t.costPerMile ?? null,
      joint_bids:           t.jointBid ?? '',
      reason_not_lowest:    local?.tenders?.[btID]?.reason_not_lowest ?? '',
      notes:                t.notes ?? '',
    };
  }
  return { tenders };
}

/**
 * Tender award history (for the XLSX export). API-first — /tenders is the
 * same TfL award register, refreshed upstream. The bundled snapshot loads in
 * parallel because it's wanted either way: it supplies `reason_not_lowest`
 * (absent from the API) and is the full fallback when the API is down.
 * Throws only when both sources fail.
 */
export async function fetchTenders() {
  const key = 'api:/tenders';
  if (_cache.has(key)) return _cache.get(key);
  const [api, local] = await Promise.all([
    loadApi('/tenders'),
    loadJson(`${BASE}/source/tenders.json`).catch(() => null),
  ]);
  const data = api ? adaptTenders(api, local) : local;
  if (!data) throw new Error('tender data unavailable from both the API and the bundled snapshot');
  _cache.set(key, data);
  return data;
}

/**
 * Upcoming tendering programme (for the XLSX export). Bundled-only for now:
 * the API's history/tender-programme endpoint pages at 1,000 rows (the full
 * set is ~1,300) and returns flat rows rather than the per-year grouping the
 * export consumes, so the weekly-committed file remains the source.
 * Resolves to null when unavailable.
 */
export async function fetchTenderProgramme() {
  try { return await loadJson(`${BASE}/source/tender-programme.json`); }
  catch { return null; }
}

// ── API-only datasets ────────────────────────────────────────────────────────
// No bundled equivalent exists for these — the weekly pipeline never carried
// them. Each resolves null when the API is unreachable and callers simply
// hide the UI they power.

/** Cached wrapper over loadApi — one fetch per endpoint per session. */
async function loadApiCached(path) {
  const key = `api:${path}`;
  if (_cache.has(key)) return _cache.get(key);
  const data = await loadApi(path);
  if (data !== null) _cache.set(key, data);
  return data;
}

/**
 * Live line-status snapshot (~5 min fresh at the edge). Adapted to
 * { capturedAt, summary: { total, good, disrupted }, byRoute } with
 * uppercase route keys; byRoute values are { status, reason, severity }
 * (severity 10 = Good Service). Routes the feed doesn't carry (school
 * routes) are simply absent.
 */
export async function fetchLineStatus() {
  const key = 'adapted:/line-status';
  if (_cache.has(key)) return _cache.get(key);
  const raw = await loadApiCached('/line-status');
  if (!raw) return null;
  const byRoute = {};
  for (const r of raw.rows ?? []) {
    if (!r?.route) continue;
    byRoute[String(r.route).toUpperCase()] = {
      status:   r.status ?? null,
      reason:   r.reason ?? null,
      severity: r.severity ?? null,
    };
  }
  const data = { capturedAt: raw.capturedAt ?? null, summary: raw.summary ?? null, byRoute };
  _cache.set(key, data);
  return data;
}

/**
 * Bus crowding per route (TfL BUSTO, annual). Returns { year, bands,
 * byRoute } with uppercase route keys; byRoute values carry peakVC, band,
 * stopname/dayType/time of the peak, and per-day-type peaks in byDay.
 */
export async function fetchCrowding() {
  const key = 'adapted:/crowding';
  if (_cache.has(key)) return _cache.get(key);
  const raw = await loadApiCached('/crowding');
  if (!raw) return null;
  const byRoute = {};
  for (const [id, rec] of Object.entries(raw.routes ?? {})) byRoute[id.toUpperCase()] = rec;
  const data = { year: raw.year ?? null, bands: raw.bands ?? [], byRoute };
  _cache.set(key, data);
  return data;
}

/** The API's pipeline-run manifest — per-dataset fetchedAt + cadence. */
export async function fetchManifest() {
  return loadApiCached('/manifest');
}
