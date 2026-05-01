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

// Per-route Minimum Performance Standards (contractual benchmarks). Values
// vary per route (EL2 high-freq EWT 0.70 vs route 122 high-freq EWT 1.20)
// because each tender contract sets its own threshold. The card surfaces
// these alongside the actuals in the Tender · Current contract section.
const routeMpsPath = path.join(DATA_DIR, 'source', 'route-mps.json');
const routeMpsFile = fs.existsSync(routeMpsPath)
  ? JSON.parse(fs.readFileSync(routeMpsPath, 'utf8'))
  : { routes: {} };
const routeMps = routeMpsFile.routes ?? {};
if (Object.keys(routeMps).length) {
  const ok = Object.values(routeMps).filter(r => r.status === 200).length;
  console.log(`Loaded route MPS for ${ok} routes`);
}

// ── Tender award enrichment ─────────────────────────────────────────────────
// Joins data/source/tenders.json (every historical tender award keyed by btID)
// to per-route fields surfaced on the route card:
//   previousOperator   the operator BEFORE the current incumbent. Walks the
//                      sorted award list and returns the first earlier
//                      operator that differs from the current incumbent — so
//                      a route that's been re-awarded to the same operator
//                      twice still shows the genuine predecessor.
//   lastAwardDate      most-recent award_announced_date
//   lastCostPerMile    cost_per_mile of the most-recent award (£/mile,
//                      directly comparable across routes regardless of length)
// Tender route_ids carry combined day/night IDs ("341/N341"), so a single
// entry feeds both the day route and the N-prefixed sibling.
const tendersPath = path.join(DATA_DIR, 'source', 'tenders.json');
const tendersLoaded = fs.existsSync(tendersPath);
const tendersFile = tendersLoaded
  ? JSON.parse(fs.readFileSync(tendersPath, 'utf8'))
  : { tenders: {} };
const tendersByRoute = {};
for (const t of Object.values(tendersFile.tenders ?? {})) {
  if (!t?.route_id || !t.award_announced_date) continue;
  for (const id of String(t.route_id).split('/').map(s => s.trim().toUpperCase()).filter(Boolean)) {
    (tendersByRoute[id] ??= []).push(t);
  }
}
for (const list of Object.values(tendersByRoute)) {
  list.sort((a, b) => b.award_announced_date.localeCompare(a.award_announced_date));
}
if (Object.keys(tendersByRoute).length) {
  console.log(`Loaded tender history for ${Object.keys(tendersByRoute).length} routes`);
}

// Upcoming tender programme — join by canonical route id.
//   nextTenderStart    contract_start_date of the next scheduled tender
//                      (= when the current contract effectively expires)
//   nextTenderYear     programme financial year ('2026-2027') for context
const programmePath = path.join(DATA_DIR, 'source', 'tender-programme.json');
const programmeLoaded = fs.existsSync(programmePath);
const programmeFile = programmeLoaded
  ? JSON.parse(fs.readFileSync(programmePath, 'utf8'))
  : { years: [] };
const programmeByRoute = {};
const todayIso = new Date().toISOString().slice(0, 10);
for (const yr of (programmeFile.years ?? [])) {
  for (const e of (yr.entries ?? [])) {
    if (!e?.route_id) continue;
    for (const id of String(e.route_id).split('/').map(s => s.trim().toUpperCase()).filter(Boolean)) {
      (programmeByRoute[id] ??= []).push(e);
    }
  }
}
// Pick "next" = earliest contract_start_date >= today. Past entries are NOT
// a useful fallback for the "Contract expires" cell -- a stale date is more
// misleading than an honest "we don't know yet". Routes without a future
// programme entry just leave the field null and the UI shows "—".
function pickNextProgramme(list) {
  if (!list?.length) return null;
  const future = list
    .filter(e => e.contract_start_date && e.contract_start_date >= todayIso)
    .sort((a, b) => a.contract_start_date.localeCompare(b.contract_start_date));
  return future[0] ?? null;
}

// Pick the contract_start_date that corresponds to the CURRENT contract
// (the one most recently awarded). The tender form 13796.aspx itself has
// no contract_start column, but the LBSL tender programme PDFs publish
// `contract_start_date` for ~400 routes (2017+). Match by joining: the
// current contract's start is the programme entry whose start is the
// earliest one strictly after `lastAwardDate` (TfL announces the award
// then the new contract begins ~6-12 months later). Capped at 2 years
// past the award so we don't accidentally pick up a much later tender.
function pickCurrentContractStart(list, lastAwardIso) {
  if (!list?.length || !lastAwardIso) return null;
  const lastAwardMs = Date.parse(lastAwardIso);
  if (!Number.isFinite(lastAwardMs)) return null;
  const twoYearsLaterMs = lastAwardMs + (2 * 365.25 * 86_400_000);
  const candidates = list
    .filter(e => {
      if (!e.contract_start_date) return false;
      const t = Date.parse(e.contract_start_date);
      return Number.isFinite(t) && t > lastAwardMs && t <= twoYearsLaterMs;
    })
    .sort((a, b) => a.contract_start_date.localeCompare(b.contract_start_date));
  return candidates[0]?.contract_start_date ?? null;
}
if (Object.keys(programmeByRoute).length) {
  console.log(`Loaded tender programme for ${Object.keys(programmeByRoute).length} routes`);
}

function derivePreviousOperator(history, current) {
  if (!history?.length) return null;
  for (const t of history.slice(1)) {
    if (t.awarded_operator && t.awarded_operator !== current) return t.awarded_operator;
  }
  return null;
}

// Derive awarded-vehicle propulsion from a tender's freeform notes. Same
// vocabulary as the live `propulsion` field so the UI can compare apples
// to apples (e.g. awarded=electric vs actual=diesel during a fleet
// transition). Plurals tolerated: "new electrics", "existing diesels".
function deriveAwardedPropulsion(notes, jointBids) {
  const pool = `${notes ?? ''} ${jointBids ?? ''}`.toLowerCase();
  if (!pool.trim()) return null;
  if (/\b(?:fuel\s*cells?|fcev|hydrogen)\b/.test(pool))                                             return 'hydrogen';
  if (/\b(?:battery\s*hybrids?|hybrid\s*electrics?|hybrids?)\b/.test(pool))                         return 'hybrid';
  if (/\b(?:zero\s*emission|battery\s*electrics?|electrics?|evs?|zedd|zesd)\b/.test(pool))         return 'electric';
  if (/\b(?:diesels?|euro\s*\d|euro\s*v[i]*)\b/.test(pool) && !/electric|hybrid/.test(pool))        return 'diesel';
  return null;
}
function deriveAwardedDeck(notes) {
  const t = (notes ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/\bdouble[\s-]?deck/.test(t))                          return 'double';
  if (/\bsingle[\s-]?deck/.test(t))                          return 'single';
  // Tail markers in vehicle codes -- DD / SD when standalone words
  if (/\b(?:zedd|hdd|dd)\b/.test(t))                         return 'double';
  if (/\b(?:zesd|hsd|sd)\b/.test(t))                         return 'single';
  return null;
}
// Programme PDFs encode vehicle type as a compact code: 'ZEDD' (zero-emission
// double-deck), 'ZESD' (single-deck), 'HDD'/'HSD' (hybrid), 'DD'/'SD' (no
// propulsion specified, just deck), 'FC' (fuel cell). Returns { propulsion, deck }.
function decodeProgrammeVehicle(vehicleType) {
  if (!vehicleType) return { propulsion: null, deck: null };
  const t = String(vehicleType).toUpperCase();
  let propulsion = null, deck = null;
  if (/ZE(?:DD|SD)|\bZE\b|\bELECTRIC|\bZERO/.test(t)) propulsion = 'electric';
  else if (/\bH(?:DD|SD)\b|HYBRID/.test(t))           propulsion = 'hybrid';
  else if (/\bFC|HYDROGEN/.test(t))                   propulsion = 'hydrogen';
  if (/\b(?:ZEDD|HDD|DD)\b/.test(t))                  deck = 'double';
  else if (/\b(?:ZESD|HSD|SD)\b/.test(t))             deck = 'single';
  return { propulsion, deck };
}

// Joint bid signal — TfL's Joint Bids column lists which other routes were
// bundled when populated, or is "N/A" / blank otherwise. Returning the raw
// list lets the UI render "Yes (with 96, 99, 178)" so the user can tell at
// a glance whether the route was tendered alone or in a package.
function deriveJointBid(notes, jointBids) {
  const jb = (jointBids ?? '').trim();
  const hasList = jb.length > 5 && !/^N\/?A$/i.test(jb);
  if (hasList) return { wasJointBid: true, jointBidNotes: jb };
  if (notes && /\b(?:joint\s*bid|jb)\b/i.test(notes)) return { wasJointBid: true, jointBidNotes: null };
  return { wasJointBid: false, jointBidNotes: null };
}

// Contract length from tender notes — TfL sometimes spells out the term
// ("five year fixed term contract", "seven year contract", "5-year"). Rare
// in the dataset (~1% of awards) but when present it's authoritative.
const TERM_WORDS = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
function deriveContractTermFromNotes(notes) {
  if (!notes) return null;
  const m = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)[\s-]?year\b/i.exec(notes);
  if (!m) return null;
  const w = m[1].toLowerCase();
  const n = TERM_WORDS[w] ?? parseInt(w, 10);
  return Number.isFinite(n) && n >= 3 && n <= 12 ? n : null;
}

// Contract length inferred from the gap between the most recent award and
// the upcoming tender's contract start. Real bus contracts are usually
// 5 + optional 2-year extension, so the observed gap (rounded) is a
// reasonable proxy when notes don't spell it out.
function deriveContractTermFromDates(lastAwardIso, nextStartIso) {
  if (!lastAwardIso || !nextStartIso) return null;
  const a = Date.parse(lastAwardIso);
  const b = Date.parse(nextStartIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const yrs = (b - a) / (365.25 * 86_400_000);
  // Clamp to plausible bus-contract lengths so a TfL data anomaly doesn't
  // surface as "12 year contract" on the route card.
  if (yrs < 3 || yrs > 10) return null;
  return Math.round(yrs);
}

// Contract length inferred from the route's own award history — median gap
// between consecutive award_announced_dates. Strong signal because each
// route's contracts have been re-tendered at consistent intervals (5y or
// 5+2 historically, 7y post-2020). Coverage: ~99% of routes (any with
// 2+ awards on file). Same 3-10y plausibility clamp.
function deriveContractTermFromHistory(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const dates = history.map(t => t.award_announced_date).filter(Boolean).sort();
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const a = Date.parse(dates[i - 1]);
    const b = Date.parse(dates[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      gaps.push((b - a) / (365.25 * 86_400_000));
    }
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  if (med < 3 || med > 10) return null;
  return Math.round(med);
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
    // Contract start date scraped directly from LBR's details.htm. Covers
    // ~600 routes (vs ~277 from the LBSL programme PDFs alone). N-route
    // rows in LBR show "See <day-route>" without their own date — the
    // alias chain falls through to the daytime route's value.
    contractStart: self?.contractStart ?? alias?.contractStart ?? null,
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
  const mps  = (routeMps[routeId]?.status === 200) ? routeMps[routeId] : null;

  // Tender history lookup. routeId is upper-case here, matching the keys in
  // tendersByRoute / programmeByRoute. N-route fallback: an N-prefixed route
  // with no separate tender history inherits from its daytime sibling (same
  // tender event covers both — see the "341/N341" combined ids above).
  const tenderHistory = tendersByRoute[routeId]
                     ?? (/^N\d/.test(routeId) ? tendersByRoute[routeId.slice(1)] : null)
                     ?? null;
  const lastTender    = tenderHistory?.[0] ?? null;
  const previousOp    = derivePreviousOperator(tenderHistory, lastTender?.awarded_operator);
  const programmeEntries = programmeByRoute[routeId]
    ?? (/^N\d/.test(routeId) ? programmeByRoute[routeId.slice(1)] : null);
  const nextProgramme = pickNextProgramme(programmeEntries);
  const currentContractStart = pickCurrentContractStart(programmeEntries, lastTender?.award_announced_date);

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
    //
    // `make` precedence: override → DVLA observed → vehicle-lookup-implied
    // (chassis manufacturer derived from the LBR vehicleType string) → last
    // known good. The lookup fallback covers ~488 routes where DVLA didn't
    // return observations because fleet samples were too sparse this week.
    make:            override.make            ?? fleetAgg?.make            ?? fallback?.make            ?? lastRec.make            ?? null,
    vehicleAgeYears: override.vehicleAgeYears ?? fleetAgg?.vehicleAgeYears ?? lastRec.vehicleAgeYears ?? null,
    fleetSize:       override.fleetSize       ?? fleetAgg?.fleetSize       ?? lastRec.fleetSize       ?? null,
    // Per-route reliability — exactly one of (ewtMinutes | onTimePercent) is
    // populated depending on serviceClass. perfPeriod tells the UI which TfL
    // reporting period the figure covers.
    serviceClass:    perf?.service_class   ?? mps?.service_class      ?? lastRec.serviceClass    ?? null,
    ewtMinutes:      perf?.ewt_minutes     ?? lastRec.ewtMinutes      ?? null,
    onTimePercent:   perf?.on_time_percent ?? lastRec.onTimePercent   ?? null,
    perfPeriod:      (perf ? routePerfPeriod : null) ?? lastRec.perfPeriod ?? null,
    // Per-route Minimum Performance Standards (the contractual benchmark
    // each route is graded against). Set per tender, vary route-by-route
    // even within the same service class.
    ewtMps:          override.ewtMps     ?? mps?.ewt_mps_minutes      ?? lastRec.ewtMps     ?? null,
    otpMps:          override.otpMps     ?? mps?.otp_mps_percent      ?? lastRec.otpMps     ?? null,
    mileageMps:      override.mileageMps ?? mps?.mileage_mps_percent  ?? lastRec.mileageMps ?? null,
    // Tender enrichment — only fall back to last-known-good when the *source
    // file* didn't load (so a missing tenders.json or programme.json after a
    // failed fetch doesn't wipe the card). When the source loaded but a
    // particular route has no entries, null IS the truthful answer and must
    // win — otherwise stale values from prior runs persist forever.
    previousOperator: override.previousOperator ?? (tendersLoaded   ? previousOp                            : (lastRec.previousOperator ?? null)),
    lastAwardDate:    override.lastAwardDate    ?? (tendersLoaded   ? (lastTender?.award_announced_date ?? null) : (lastRec.lastAwardDate    ?? null)),
    lastCostPerMile:  override.lastCostPerMile  ?? (tendersLoaded   ? (lastTender?.cost_per_mile        ?? null) : (lastRec.lastCostPerMile  ?? null)),
    // Award count lets the UI tell apart "no previous operator because the
    // incumbent has held the route from day one" (count >= 2 + previousOp
    // null = "No change") from "no previous operator because we only have one
    // award on file" (count == 1 = "First award") from "no tender history
    // at all" (count == 0 = "—").
    tenderAwardCount: tendersLoaded ? (tenderHistory?.length ?? 0) : (lastRec.tenderAwardCount ?? 0),
    // Bids received on the most recent tender. 1 = sole-source; 4-5 = highly
    // competitive. Caps reality-check at 12 to discard data anomalies.
    numberOfTenderers: override.numberOfTenderers ?? (tendersLoaded ? ((Number.isFinite(lastTender?.number_of_tenderers) && lastTender.number_of_tenderers > 0 && lastTender.number_of_tenderers <= 12) ? lastTender.number_of_tenderers : null) : (lastRec.numberOfTenderers ?? null)),
    // Joint-bid flag — boolean only. The card shows just "Yes" when true
    // and hides the row otherwise; the bundled-routes phrase TfL fills in
    // can be a paragraph long and would crowd the card.
    wasJointBid: override.wasJointBid ?? (tendersLoaded ? deriveJointBid(lastTender?.notes, lastTender?.joint_bids).wasJointBid : (lastRec.wasJointBid ?? null)),
    // Contract length — note-derived (rare but authoritative) with a fallback
    // to the lastAwardDate→nextTenderStart gap (a reasonable approximation
    // since real bus contracts run 5y+optional-2y, capped 3-10 to filter out
    // anomalies).
    // Contract start date — when the current contract began service.
    // Two-tier source chain:
    //   1. LBR `details.htm` "Contract specification | date" column
    //      (~600 routes covered; primary source).
    //   2. LBSL tender programme PDFs (~277 routes; cross-validates
    //      and fills any gaps LBR misses).
    // The TfL tender form 13796.aspx itself has no contract-start column
    // so neither source is the tender-result page.
    contractStartDate: override.contractStartDate
                    ?? details.contractStart
                    ?? (programmeLoaded ? currentContractStart : null)
                    ?? (lastRec.contractStartDate ?? null),
    contractTermYears: override.contractTermYears ?? (
      // Tier 1: explicit term in tender notes (rare, authoritative).
      (tendersLoaded ? deriveContractTermFromNotes(lastTender?.notes) : null) ??
      // Tier 2: gap between this award and the upcoming programme contract
      // start (only when both are known).
      (tendersLoaded && programmeLoaded ? deriveContractTermFromDates(lastTender?.award_announced_date, nextProgramme?.contract_start_date) : null) ??
      // Tier 3: median inter-award gap from the route's own history
      // (~99% coverage; strong signal since each route's tenders have
      // historically re-cycled at consistent intervals).
      (tendersLoaded ? deriveContractTermFromHistory(tenderHistory) : null) ??
      (lastRec.contractTermYears ?? null)
    ),
    // Awarded vehicle spec — parsed from the most recent tender's notes.
    // Useful as a comparison against the *actual* live fleet (`propulsion` /
    // `deck` above): a route mid-transition will show awarded=electric but
    // actual=hybrid until the new buses arrive.
    awardedPropulsion: override.awardedPropulsion ?? (tendersLoaded ? deriveAwardedPropulsion(lastTender?.notes, lastTender?.joint_bids) : (lastRec.awardedPropulsion ?? null)),
    awardedDeck:       override.awardedDeck       ?? (tendersLoaded ? deriveAwardedDeck(lastTender?.notes)                                : (lastRec.awardedDeck       ?? null)),
    // Previous-tender vehicle spec — derived from the SECOND-most-recent
    // tender. The UI only renders this when it differs from the most recent
    // ("was Hybrid (double)") — a clean propulsion-transition indicator.
    prevAwardedPropulsion: override.prevAwardedPropulsion ?? (tendersLoaded && tenderHistory?.[1] ? deriveAwardedPropulsion(tenderHistory[1].notes, tenderHistory[1].joint_bids) : (lastRec.prevAwardedPropulsion ?? null)),
    prevAwardedDeck:       override.prevAwardedDeck       ?? (tendersLoaded && tenderHistory?.[1] ? deriveAwardedDeck(tenderHistory[1].notes)                                   : (lastRec.prevAwardedDeck       ?? null)),
    nextTenderStart:  override.nextTenderStart  ?? (programmeLoaded ? (nextProgramme?.contract_start_date ?? null) : (lastRec.nextTenderStart ?? null)),
    nextTenderYear:   override.nextTenderYear   ?? (programmeLoaded ? (nextProgramme?.programme_year      ?? null) : (lastRec.nextTenderYear  ?? null)),
    // 'x' marker on the programme PDF means TfL has flagged the route as
    // eligible for a 2-year extension on top of the base contract length.
    // Materially changes when the contract really ends.
    extensionEligible: override.extensionEligible ?? (programmeLoaded ? (nextProgramme?.two_year_extension ?? false) : (lastRec.extensionEligible ?? null)),
    // Upcoming programme spec — what TfL plans the next contract to require.
    // Often the strongest signal of an electrification transition (a route
    // currently running diesel with awardedPropulsion=null but
    // nextAwardPropulsion=electric is a route about to convert).
    nextAwardPropulsion: override.nextAwardPropulsion ?? (programmeLoaded ? decodeProgrammeVehicle(nextProgramme?.vehicle_type).propulsion : (lastRec.nextAwardPropulsion ?? null)),
    nextAwardDeck:       override.nextAwardDeck       ?? (programmeLoaded ? decodeProgrammeVehicle(nextProgramme?.vehicle_type).deck       : (lastRec.nextAwardDeck       ?? null)),
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

// ── Make / model alignment audit ────────────────────────────────────────────
// Cross-check the DVLA-observed `make` against the vehicle-lookup's chassis
// `make` (which comes from the LBR vehicleType string). Mismatches usually
// mean either (a) sparse DVLA observations caught a loan-in bus, (b) the
// route is mid-way through a fleet swap, or (c) the lookup is missing/wrong.
// Surfaced as a build-log line + a diff written to data/source/ so the team
// can investigate without grepping the whole classifications file.
const audit = { aligned: [], mismatch: [], dvlaOnly: [], lookupOnly: [], neither: [] };
for (const [id, r] of Object.entries(classifications)) {
  // The build's `make` field prefers DVLA over lookup, so it matches both
  // when both agree. To flag genuine drift we re-derive the DVLA-observed
  // value (mode of `make` across this route's observed registrations) and
  // compare it to the lookup-implied chassis manufacturer.
  const norm = v => (v ? String(v).toUpperCase() : null);
  const obs  = routeVehicles[id] ?? routeVehicles[id?.toUpperCase()] ?? [];
  const dvlaCounts = {};
  for (const entry of obs) {
    const reg = (typeof entry === 'string' ? entry : entry?.reg)?.toUpperCase();
    const m = norm(fleet[reg]?.make);
    if (m) dvlaCounts[m] = (dvlaCounts[m] ?? 0) + 1;
  }
  let rd = null;
  for (const [m, n] of Object.entries(dvlaCounts)) if (rd == null || n > dvlaCounts[rd]) rd = m;
  const l = norm(vehicleLookup[r.vehicleType]?.make);
  if (!rd && !l)        audit.neither.push(id);
  else if (!rd)         audit.lookupOnly.push(id);
  else if (!l)          audit.dvlaOnly.push({ id, dvla: rd });
  else if (rd === l)    audit.aligned.push(id);
  else                  audit.mismatch.push({ id, dvla: rd, lookup: l, model: r.vehicleType, fleetSize: r.fleetSize ?? 0 });
}
const auditOut = path.join(DATA_DIR, 'source', 'make-alignment.json');
fs.mkdirSync(path.dirname(auditOut), { recursive: true });
fs.writeFileSync(auditOut, JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary: {
    aligned:    audit.aligned.length,
    mismatch:   audit.mismatch.length,
    dvla_only:  audit.dvlaOnly.length,
    lookup_only: audit.lookupOnly.length,
    neither:    audit.neither.length,
  },
  mismatch: audit.mismatch,
}, null, 2), 'utf8');
console.log(`  Make alignment: aligned=${audit.aligned.length} mismatch=${audit.mismatch.length} dvla-only=${audit.dvlaOnly.length} lookup-only=${audit.lookupOnly.length} neither=${audit.neither.length}`);
console.log(`  Mismatch detail: ${auditOut}`);
