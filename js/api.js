/**
 * api.js – Data access layer
 *
 * Loads static GeoJSON/JSON files from the /data directory.
 * Stop data is fetched live from the TfL API (authoritative source, no key needed).
 * All responses are cached in memory for the session.
 */

const BASE    = './data';
const TFL_API = 'https://api.tfl.gov.uk';

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
 * Returns the route classifications map.
 * @returns {Promise<object>}
 */
export async function fetchRouteClassifications() {
  const data = await loadJson(`${BASE}/route_classifications.json`);
  return data.routes ?? {};
}

/**
 * Returns classification info for a single route.
 * @param {string} routeId
 * @returns {Promise<object|null>}
 */
export async function fetchRouteClassification(routeId) {
  const data = await loadJson(`${BASE}/route_classifications.json`);
  return data.routes?.[routeId.toUpperCase()] ?? null;
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
 * Returns located garages: [{ code, name, operator, address, lat, lon }, …]
 * Garages without a successful geocode are omitted.
 */
export async function fetchGarageLocations() {
  try {
    const data = await loadJson(`${BASE}/garage-locations.json`);
    return Object.values(data.garages ?? {}).filter(g => g.lat != null && g.lon != null);
  } catch (err) {
    console.warn('garage-locations.json not available:', err.message);
    return [];
  }
}

/**
 * Fetches stops for a route live from the TfL API. Throws on network error —
 * callers decide whether to show a fallback or surface the failure to the user.
 * @param {string} routeId
 * @returns {Promise<object[]>} Array of GeoJSON-style feature objects
 */
export async function fetchStopsForRoute(routeId) {
  const id       = routeId.toUpperCase();
  const cacheKey = `tfl:stops:${id}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const res = await fetch(`${TFL_API}/Line/${encodeURIComponent(id)}/StopPoints`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const stops = Array.isArray(data) ? data : (data.value ?? []);

  const features = stops
    .filter(s => s.lat && s.lon)
    .map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id:        s.naptanId ?? '',
        name:      s.commonName ?? 'Stop',
        indicator: s.indicator ?? null,
        towards:   s.additionalProperties?.find(p => p.key === 'Towards')?.value ?? null,
        routes:    (s.lines ?? []).map(l => l.id.toUpperCase()).sort().join(','),
      },
    }));

  _cache.set(cacheKey, features);
  return features;
}
