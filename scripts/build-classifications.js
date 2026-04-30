/**
 * build-classifications.js — Route classification builder
 *
 * Derives route type and length band purely from data already fetched
 * by fetch-data.js — no external CSV or third-party source needed.
 *
 * Inputs:
 *   data/route_destinations.json    — service_types per route (from API)
 *   data/routes/<id>.geojson        — geometry for length calculation
 *   data/frequencies.json           — TfL-primary numeric headways per route
 *   data/source/route_details.json  — scraper-sourced vehicle / operator / PVR / headways (fallback)
 *   data/source/vehicle-fleet.json  — per-registration DVLA make / fuelType / age (fleet aggregator)
 *   data/source/route-vehicles.json — per-route observed registrations from TfL arrivals
 *
 * Fleet-derived fields (per route):
 *   make             — DVLA-reported manufacturer (mode across observed regs)
 *   propulsion       — DVLA fuelType, mapped — overrides LBR-string heuristic
 *   vehicleAgeYears  — mean age computed from monthOfFirstRegistration
 *   fleetSize        — count of unique observed registrations matched against fleet
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

function deriveType(routeId, serviceTypes, twentyFourSet) {
  const id = routeId.toUpperCase();
  const types = serviceTypes.map(s => s.toLowerCase());

  // Night routes: N-prefix or API confirms night-only
  if (/^N\d/.test(id) || (types.includes('night') && !types.includes('regular'))) return 'night';

  // 24-hour routes: either the API returns both Regular + Night (rare these
  // days), OR the daytime route has a corresponding N-prefix sibling sharing
  // the same timetable page on routes.htm (the authoritative signal now that
  // TfL's service_types is largely flat).
  if (types.includes('night') && types.includes('regular')) return 'twentyfour';
  if (twentyFourSet?.has(id)) return 'twentyfour';

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

// ── Main ──────────────────────────────────────────────────────────────────────

// Load service types from already-fetched destinations data
const destinationsPath = path.join(DATA_DIR, 'route_destinations.json');
if (!fs.existsSync(destinationsPath)) {
  console.error('Error: data/route_destinations.json not found. Run fetch-data first.');
  process.exit(1);
}
const destinations = JSON.parse(fs.readFileSync(destinationsPath, 'utf8')).routes ?? {};

// Categorical frequency band per route — { "1": "high", "N86": "low" }.
// Produced by fetch-frequencies.js from TfL timetables with scraper fallback.
const frequenciesPath = path.join(DATA_DIR, 'frequencies.json');
const frequencyBands  = fs.existsSync(frequenciesPath)
  ? JSON.parse(fs.readFileSync(frequenciesPath, 'utf8'))
  : {};
if (Object.keys(frequencyBands).length) {
  console.log(`Loaded frequency bands for ${Object.keys(frequencyBands).length} routes`);
}

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
// bustimes.org cross-reference — used only when routes.htm doesn't yield an
// operator. Independent source, resilient to londonbusroutes.net downtime.
const operatorByRouteBustimes = {};
for (const [k, v] of Object.entries(detailsFile.operatorByRouteBustimes ?? {})) {
  operatorByRouteBustimes[k.toUpperCase()] = v;
}
// Daytime routes that are actually 24-hour services: derived from routes.htm
// href-share detection. If N128 aliases to 128, then 128 runs 24/7.
const twentyFourSet = new Set(Object.values(routeAliases));

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

// ── Fleet aggregator ────────────────────────────────────────────────────────
// Joins data/source/vehicle-fleet.json (registration → DVLA make / fuelType /
// monthOfFirstRegistration) with data/source/route-vehicles.json (per-route
// list of registrations observed in TfL arrivals) and computes per-route
// aggregates: dominant make, dominant propulsion, mean fleet age in years,
// and observed fleet size. Only DVLA entries with status 200 contribute.
const fleetPath = path.join(DATA_DIR, 'source', 'vehicle-fleet.json');
const fleet = fs.existsSync(fleetPath)
  ? (JSON.parse(fs.readFileSync(fleetPath, 'utf8')).vehicles ?? {})
  : {};
const routeVehiclesPath = path.join(DATA_DIR, 'source', 'route-vehicles.json');
const routeVehiclesFile = fs.existsSync(routeVehiclesPath)
  ? JSON.parse(fs.readFileSync(routeVehiclesPath, 'utf8'))
  : { routes: {} };
const routeVehicles = routeVehiclesFile.routes ?? {};

if (Object.keys(fleet).length) {
  console.log(`Loaded vehicle fleet for ${Object.keys(fleet).length} registrations (DVLA cache)`);
}
if (Object.keys(routeVehicles).length) {
  console.log(`Loaded route-vehicle observations for ${Object.keys(routeVehicles).length} routes`);
}

// Per-route reliability metrics from the QSI PDF (high-frequency routes get
// EWT, low-frequency get OTP). Surfaced on the route card as a "Reliability"
// row. Falls through silently if the file is missing.
const routePerfPath = path.join(DATA_DIR, 'source', 'route-performance.json');
const routePerfFile = fs.existsSync(routePerfPath)
  ? JSON.parse(fs.readFileSync(routePerfPath, 'utf8'))
  : { routes: {} };
const routePerf = routePerfFile.routes ?? {};
const routePerfPeriod = routePerfFile.periodLabel ?? null;
if (Object.keys(routePerf).length) {
  console.log(`Loaded route performance for ${Object.keys(routePerf).length} routes (${routePerfPeriod ?? 'unknown period'})`);
}

function modeOf(counts) {
  let best = null, bestN = 0;
  for (const [k, n] of Object.entries(counts)) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function aggregateRouteFleet(routeId) {
  const obs = routeVehicles[routeId] ?? routeVehicles[routeId?.toUpperCase()] ?? [];
  if (!obs.length) return null;

  const makes = {}, props = {};
  let ageSum = 0, ageN = 0, matched = 0;
  const nowMs = Date.now();

  for (const entry of obs) {
    const reg = (typeof entry === 'string' ? entry : entry?.reg)?.toUpperCase();
    if (!reg) continue;
    const f = fleet[reg];
    if (!f || f.dvlaStatus !== 200) continue;
    matched++;

    if (f.make)     makes[f.make]     = (makes[f.make]     ?? 0) + 1;
    if (f.fuelType) props[f.fuelType] = (props[f.fuelType] ?? 0) + 1;

    // Age from first-registration month — closer to in-service than build year.
    if (typeof f.monthOfFirstRegistration === 'string') {
      const m = /^(\d{4})-(\d{2})$/.exec(f.monthOfFirstRegistration);
      if (m) {
        const regDate = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
        const yrs = (nowMs - regDate) / (365.25 * 86_400_000);
        if (yrs >= 0 && yrs < 40) { ageSum += yrs; ageN++; }
      }
    }
  }

  if (!matched) return null;
  return {
    make:            modeOf(makes),
    propulsion:      modeOf(props),
    vehicleAgeYears: ageN ? Math.round((ageSum / ageN) * 10) / 10 : null,
    fleetSize:       matched,
  };
}

// Load the previously-committed classifications so we can preserve
// scraper-derived fields (deck, vehicleType, propulsion, operator, garageName,
// garageCode, pvr) when the upstream scrape of londonbusroutes.net or
// bustimes.org has failed this run. Without this fallback a single failed
// scrape wipes weeks of data out of the detail panel — which is exactly what
// happened on 2026-04-20 and motivated this guard. The project's own spec
// requires retaining the last-known-good dataset when a step produces empty
// data.
let lastGood = {};
try {
  const raw = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  lastGood = raw.routes ?? {};
  if (Object.keys(lastGood).length) {
    console.log(`Loaded last-known-good classifications for ${Object.keys(lastGood).length} routes (scraper-field fallback)`);
  }
} catch {
  // First run, or file missing — nothing to preserve.
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
  const type         = deriveType(routeId, serviceTypes, twentyFourSet);
  const isPrefix     = deriveIsPrefix(routeId, type);
  const lengthBand   = deriveLengthBand(routeLengthKm(geojson));

  // For N-routes TfL doesn't list separately (e.g. N12 is just night service
  // of line 12), fall back to the daytime-alias's band. Prefer the explicit
  // alias from routes.htm; otherwise strip the N prefix.
  const aliasIdForFreq = routeAliases[routeId]
                       ?? (/^N\d/.test(routeId) ? routeId.slice(1) : null);
  const frequencyRaw   = frequencyBands[routeId]
                      ?? (aliasIdForFreq ? frequencyBands[aliasIdForFreq] : null)
                      ?? null;

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
    operator:    self?.operator    ?? alias?.operator    ?? operatorByRoute[routeId] ?? operatorByRouteBustimes[routeId] ?? null,
    garageName:  self?.garageName  ?? alias?.garageName  ?? null,
    garageCode:  self?.garageCode  ?? alias?.garageCode  ?? null,
    pvr:         self?.pvr         ?? alias?.pvr         ?? null,
    headwayMin:  self?.headwayMin  ?? alias?.headwayMin  ?? null,
  };
  const vehicleType = details.vehicleType;
  // Fall back to the manual vehicle lookup for deck/propulsion when the
  // automatic derivation in fetch-route-details.js returned null. Try several
  // normalised variants so that a stored key like "B5LH/Gemini 3" still
  // matches a raw input like "B5LH/Gemini 3 2D" or "Enviro400 MMC 2D*".
  function vehicleLookupBestMatch(raw) {
    if (!raw) return null;
    const transforms = [
      s => s,
      s => s.replace(/[*†‡§\u0086]+$/g, ''),
      s => s.replace(/\s*[123]D[?*†‡§\u0086]?\s*$/, ''),
      s => s.replace(/^[A-Z0-9]{3,5}\s+/, ''),       // strip fleet prefix (E20D, B5LH...)
      s => s.replace(/\s*\d+\.?\d*m\//i, '/'),        // strip size "10.5m/" keeping slash
    ];
    // Try every combination of transforms (order-independent)
    const seen = new Set();
    const stack = [raw];
    while (stack.length) {
      const cur = stack.pop().trim();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      if (vehicleLookup[cur]) return vehicleLookup[cur];
      for (const t of transforms) {
        const next = t(cur);
        if (next !== cur) stack.push(next);
      }
    }
    return null;
  }
  const fallback    = vehicleLookupBestMatch(vehicleType);
  const fleetAgg    = aggregateRouteFleet(routeId);
  const deck        = details.deck       ?? fallback?.deck       ?? null;

  // ── Propulsion precedence ───────────────────────────────────────────────
  // Naive "DVLA always wins" was wrong: with fleetSize 1–3 (typical right
  // now), one off-fleet observation flips a route's verdict. Worse, DVLA's
  // fuelType for hybrid chassis is inconsistent — Volvo B5LH buses come back
  // as `HEAVY OIL` (= our 'diesel') as often as `HYBRID ELECTRIC`. The
  // bustimes.org cross-check (audit-vehicle-data.js) found 64 routes where
  // we said diesel but the LBR vehicle string explicitly carried B5LH /
  // E40H / NB4L / similar — unambiguous hybrid markers.
  //
  // New rule:
  //   • details.propulsion ∈ {hybrid, electric, hydrogen} → trust LBR.
  //     These verdicts come from explicit fleet codes (B5LH, BYD, BZL,
  //     Streetdeck Electroliner, FCEV, etc.) which are 100% specific.
  //   • details.propulsion = 'diesel' (LBR's default when no marker) →
  //     trust DVLA when we have ≥5 observations agreeing — that's enough
  //     evidence to override LBR's silence (e.g. a route that just went
  //     electric mid-week).
  //   • Otherwise → fall through to LBR / vehicle-lookup / last-known-good.
  const HIGH_CONF_OBS = 5;
  const lbrProp  = details.propulsion;
  const dvlaProp = fleetAgg?.propulsion;
  const dvlaObs  = fleetAgg?.fleetSize ?? 0;
  let propulsion;
  if (lbrProp && lbrProp !== 'diesel') {
    propulsion = lbrProp;
  } else if (dvlaProp && dvlaObs >= HIGH_CONF_OBS) {
    propulsion = dvlaProp;
  } else {
    propulsion = lbrProp ?? fallback?.propulsion ?? null;
  }
  const operator     = details.operator;
  const garageName   = details.garageName;
  const garageCode   = details.garageCode;
  const pvr          = details.pvr;
  // Frequency band: TfL-primary, with a tertiary fallback on the headway
  // column scraped straight from details.htm. The pipeline tier order is:
  //   1. fetch-frequencies.js → TfL /Line/<id>/Timetable (primary)
  //   2. fetch-frequencies.js → londonbusroutes.net/times/<id>.htm (secondary)
  //   3. headwayMin from details.htm parsed by fetch-route-details.js (here)
  // Tier 3 catches routes where TfL's timetable endpoint is sparse or down but
  // details.htm still publishes a Mon-Sat headway. Same ≤12 cutoff as
  // bandForHeadway in fetch-frequencies.js so the binning rule is identical
  // across all three tiers. No last-known-good fallback — if every tier says
  // null, the route is genuinely unscheduled.
  const frequency    = frequencyRaw
                    ?? (typeof details.headwayMin === 'number' && details.headwayMin > 0
                          ? (details.headwayMin <= 12 ? 'high' : 'low')
                          : null);

  // Manual overrides win over everything else (scraper + lookup). Scraper-
  // derived fields fall back to last-known-good before we give up to null, so
  // a flaky upstream scrape doesn't wipe vehicle/operator/pvr/etc. that we
  // already knew about from a previous run.
  // Per-route reliability metric from TfL's QSI PDF. Last-known-good fallback
  // because the PDF only updates every ~4 weeks — between releases the value
  // is the same as last run, so preserving the previous reading is correct.
  const perf = routePerf[routeId] ?? null;

  const override = routeOverrides[routeId] ?? {};
  const lastRec  = lastGood[routeId] ?? {};
  classifications[routeId] = {
    type:        override.type        ?? type,
    isPrefix:    override.isPrefix    ?? isPrefix,
    lengthBand:  override.lengthBand  ?? lengthBand,
    deck:        override.deck        ?? deck        ?? lastRec.deck        ?? null,
    vehicleType: override.vehicleType ?? vehicleType ?? lastRec.vehicleType ?? null,
    propulsion:  override.propulsion  ?? propulsion  ?? lastRec.propulsion  ?? null,
    operator:    override.operator    ?? operator    ?? lastRec.operator    ?? null,
    garageName:  override.garageName  ?? garageName  ?? lastRec.garageName  ?? null,
    garageCode:  override.garageCode  ?? garageCode  ?? lastRec.garageCode  ?? null,
    pvr:         override.pvr         ?? pvr         ?? lastRec.pvr         ?? null,
    // Frequency is TfL-primary — no last-good fallback needed (if TfL says the
    // route has no published timetable that's new authoritative information).
    frequency:   override.frequency   ?? frequency,
    // Fleet aggregates from DVLA (joined via TfL arrivals registrations). All
    // four fall back to last-known-good when this run produced no observations
    // (e.g. TfL arrivals returned empty) so a flaky upstream doesn't wipe the
    // fields between runs.
    make:            override.make            ?? fleetAgg?.make            ?? lastRec.make            ?? null,
    vehicleAgeYears: override.vehicleAgeYears ?? fleetAgg?.vehicleAgeYears ?? lastRec.vehicleAgeYears ?? null,
    fleetSize:       override.fleetSize       ?? fleetAgg?.fleetSize       ?? lastRec.fleetSize       ?? null,
    // Per-route reliability — exactly one of (ewtMinutes | onTimePercent) is
    // populated depending on serviceClass. perfPeriod tells the UI which TfL
    // reporting period the figure covers.
    serviceClass:    perf?.service_class   ?? lastRec.serviceClass    ?? null,
    ewtMinutes:      perf?.ewt_minutes     ?? lastRec.ewtMinutes      ?? null,
    onTimePercent:   perf?.on_time_percent ?? lastRec.onTimePercent   ?? null,
    perfPeriod:      (perf ? routePerfPeriod : null) ?? lastRec.perfPeriod ?? null,
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
