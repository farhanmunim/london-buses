/**
 * build-classifications.js — Route classification builder
 *
 * Derives route type and length band purely from data already fetched
 * by fetch-data.js — no external CSV or third-party source needed.
 *
 * Inputs:
 *   data/route_destinations.json   — service_types per route (from API)
 *   data/routes/<id>.geojson       — geometry for length calculation
 *
 * Output:
 *   data/route_classifications.json — routeId → { type, isPrefix, lengthBand }
 *
 * Route type derivation:
 *   night      – route ID starts with N, or service_types = ["Night"]
 *   twentyfour – service_types includes both "Regular" and "Night"
 *   school     – route ID is purely numeric in the 600–799 range
 *   regular    – everything else
 *   isPrefix   – ID starts with a letter and is not a night route
 *                e.g. A10, B11, C1, EL1, W7, X26
 *
 * Length band (derived from geometry, using Haversine approximation):
 *   short  < 8 km
 *   medium 8–20 km
 *   long   > 20 km
 *
 * Run: npm run build-classifications
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const DATA_DIR   = path.join(ROOT, 'data');
const ROUTES_DIR = path.join(DATA_DIR, 'routes');
const OUT_PATH   = path.join(DATA_DIR, 'route_classifications.json');

// ── Route type derivation ─────────────────────────────────────────────────────

function deriveType(routeId, serviceTypes) {
  const id = routeId.toUpperCase();
  const types = serviceTypes.map(s => s.toLowerCase());

  // Night routes: N-prefix or API confirms night-only
  if (/^N\d/.test(id) || (types.includes('night') && !types.includes('regular'))) return 'night';

  // 24-hour routes: API returns both Regular and Night service types
  if (types.includes('night') && types.includes('regular')) return 'twentyfour';

  // School routes: purely numeric IDs in the 600–799 range
  const num = parseInt(id, 10);
  if (/^\d+$/.test(id) && num >= 600 && num <= 799) return 'school';

  return 'regular';
}

function deriveIsPrefix(routeId, type) {
  if (type === 'night') return false; // N-prefix is its own category
  return /^[A-Z]/i.test(routeId);
}

// ── Length calculation (Haversine) ────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function routeLengthKm(geojson) {
  let totalKm = 0;
  for (const feature of (geojson.features ?? [])) {
    // Only measure one direction to avoid double-counting
    if (String(feature.properties?.direction) !== '1') continue;
    const { type, coordinates } = feature.geometry;
    const segments = type === 'MultiLineString' ? coordinates : [coordinates];
    for (const seg of segments) {
      for (let i = 0; i < seg.length - 1; i++) totalKm += haversineKm(seg[i], seg[i + 1]);
    }
  }
  return totalKm;
}

function deriveLengthBand(km) {
  if (km < 8)  return 'short';
  if (km <= 20) return 'medium';
  return 'long';
}

// ── Frequency band ────────────────────────────────────────────────────────────

/**
 * Derive a frequency band from a weekday headway in minutes.
 * Uses the weekday headway as the primary signal; falls back to Sunday/Evening.
 */
function deriveFrequencyBand(details) {
  const h = details?.freqWeekday ?? details?.freqSunday ?? details?.freqEvening;
  if (h == null) return null;
  if (h <= 6)  return 'high';
  if (h <= 15) return 'regular';
  return 'low';
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Load service types from already-fetched destinations data
const destinationsPath = path.join(DATA_DIR, 'route_destinations.json');
if (!fs.existsSync(destinationsPath)) {
  console.error('Error: data/route_destinations.json not found. Run fetch-data first.');
  process.exit(1);
}
const destinations = JSON.parse(fs.readFileSync(destinationsPath, 'utf8')).routes ?? {};

// Load supplementary route details (deck type + frequency) if available
const detailsPath = path.join(DATA_DIR, 'source', 'route_details.json');
const detailsFile = fs.existsSync(detailsPath)
  ? JSON.parse(fs.readFileSync(detailsPath, 'utf8'))
  : { routes: {}, aliases: {}, operatorByRoute: {} };
const routeDetails     = detailsFile.routes          ?? {};
// Case-insensitive aliases: map every key to upper-case so lookups match
const routeAliases = {};
for (const [k, v] of Object.entries(detailsFile.aliases ?? {})) {
  routeAliases[k.toUpperCase()] = String(v).toUpperCase();
}
const operatorByRoute = {};
for (const [k, v] of Object.entries(detailsFile.operatorByRoute ?? {})) {
  operatorByRoute[k.toUpperCase()] = v;
}

// Load manual vehicle-type → (deck, propulsion) lookup used as fallback when
// automatic derivation fails. Maintained manually via scripts/update-vehicle-lookup.js.
const lookupPath = path.join(DATA_DIR, 'vehicle-lookup.json');
const vehicleLookup = fs.existsSync(lookupPath)
  ? (JSON.parse(fs.readFileSync(lookupPath, 'utf8')).vehicles ?? {})
  : {};
if (Object.keys(vehicleLookup).length) {
  console.log(`Loaded vehicle lookup with ${Object.keys(vehicleLookup).length} entries`);
}

// Load per-route manual overrides. Any field set here WINS over scraped/derived
// data. Keys are route IDs (case-insensitive). Entries starting with "_" are
// ignored (useful for documentation/examples).
const overridesPath = path.join(DATA_DIR, 'route-overrides.json');
const rawOverrides  = fs.existsSync(overridesPath)
  ? (JSON.parse(fs.readFileSync(overridesPath, 'utf8')).routes ?? {})
  : {};
const routeOverrides = {};
for (const [k, v] of Object.entries(rawOverrides)) {
  if (k.startsWith('_')) continue;
  routeOverrides[k.toUpperCase()] = v;
}
if (Object.keys(routeOverrides).length) {
  console.log(`Loaded ${Object.keys(routeOverrides).length} manual route override(s)`);
}
if (Object.keys(routeDetails).length) {
  console.log(`Loaded route details for ${Object.keys(routeDetails).length} routes (operator, garage, PVR, deck, frequency)`);
} else {
  console.warn('  Note: route_details.json not found — operator/garage/PVR/deck/frequency will be omitted. Run fetch-route-details first.');
}

// Read all route GeoJSON files
const routeFiles = fs.readdirSync(ROUTES_DIR)
  .filter(f => f.endsWith('.geojson') && f !== 'index.json')
  .sort();

console.log(`Classifying ${routeFiles.length} routes...`);

const classifications = {};

for (const file of routeFiles) {
  const routeId = file.replace('.geojson', '');
  let geojson;
  try {
    geojson = JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8'));
  } catch {
    continue;
  }

  const serviceTypes = destinations[routeId]?.service_types ?? [];
  const type         = deriveType(routeId, serviceTypes);
  const isPrefix     = deriveIsPrefix(routeId, type);
  const km           = routeLengthKm(geojson);
  const lengthBand   = deriveLengthBand(km);

  // Fallback chain for route data:
  //   1. Scraped details for this routeId (details.htm)
  //   2. If this is a night route that's actually a 24-hour alias of a daytime
  //      route (per routes.htm href sharing), inherit from the daytime route
  //   3. Operator-only fallback from routes.htm's 3rd column
  const self    = routeDetails[routeId] ?? null;
  const aliasId = routeAliases[routeId] ?? null;
  const alias   = aliasId ? (routeDetails[aliasId] ?? null) : null;
  const details = {
    deck:        self?.deck        ?? alias?.deck        ?? null,
    vehicleType: self?.vehicleType ?? alias?.vehicleType ?? null,
    propulsion:  self?.propulsion  ?? alias?.propulsion  ?? null,
    operator:    self?.operator    ?? alias?.operator    ?? operatorByRoute[routeId] ?? null,
    garageName:  self?.garageName  ?? alias?.garageName  ?? null,
    garageCode:  self?.garageCode  ?? alias?.garageCode  ?? null,
    pvr:         self?.pvr         ?? alias?.pvr         ?? null,
    freqWeekday: self?.freqWeekday ?? alias?.freqWeekday ?? null,
    freqSunday:  self?.freqSunday  ?? alias?.freqSunday  ?? null,
    freqEvening: self?.freqEvening ?? alias?.freqEvening ?? null,
  };
  const vehicleType = details.vehicleType;
  // Fall back to the manual vehicle lookup for deck/propulsion when the
  // automatic derivation in fetch-route-details.js returned null.
  const fallback    = vehicleType ? vehicleLookup[vehicleType] : null;
  const deck        = details.deck       ?? fallback?.deck       ?? null;
  const propulsion  = details.propulsion ?? fallback?.propulsion ?? null;
  const operator     = details.operator;
  const garageName   = details.garageName;
  const garageCode   = details.garageCode;
  const pvr          = details.pvr;
  const frequency    = deriveFrequencyBand(details);

  // Manual overrides win over everything else (scraper + lookup)
  const override = routeOverrides[routeId] ?? {};
  classifications[routeId] = {
    type:        override.type        ?? type,
    isPrefix:    override.isPrefix    ?? isPrefix,
    lengthBand:  override.lengthBand  ?? lengthBand,
    deck:        override.deck        ?? deck,
    vehicleType: override.vehicleType ?? vehicleType,
    propulsion:  override.propulsion  ?? propulsion,
    operator:    override.operator    ?? operator,
    garageName:  override.garageName  ?? garageName,
    garageCode:  override.garageCode  ?? garageCode,
    pvr:         override.pvr         ?? pvr,
    frequency:   override.frequency   ?? frequency,
  };
}

const counts = {
  regular:    Object.values(classifications).filter(c => c.type === 'regular'    && !c.isPrefix).length,
  prefix:     Object.values(classifications).filter(c => c.isPrefix).length,
  twentyfour: Object.values(classifications).filter(c => c.type === 'twentyfour').length,
  night:      Object.values(classifications).filter(c => c.type === 'night').length,
  school:     Object.values(classifications).filter(c => c.type === 'school').length,
};

const output = {
  generatedAt: new Date().toISOString(),
  count:       Object.keys(classifications).length,
  typeCounts:  counts,
  routes:      classifications,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
console.log(`Written: ${OUT_PATH}`);
console.log('  Routes:', output.count);
console.log('  Types:', counts);
