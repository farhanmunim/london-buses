/**
 * fetch-route-details.js — Per-route supplementary data
 *
 * Produces data/source/route_details.json consumed by build-classifications.js.
 * Sources (in priority order):
 *
 *   1. data/garages.geojson  — authoritative operator / garage / PVR / route→garage
 *                              allocation (built from londonbusroutes.net's CSV).
 *   2. londonbusroutes.net/details.htm — vehicle type string per route. Parsed
 *                              via robust regex (not fixed-width columns) so
 *                              alignment drift and footnote rows don't corrupt
 *                              the result.
 *   3. TfL API /Line/{id}/Route — service type (Regular / Night / School).
 *
 * Output schema (unchanged — drop-in replacement for the old scraper):
 *   {
 *     generatedAt, source, routeCount,
 *     routes:      { [routeId]: { deck, vehicleType, propulsion, operator,
 *                                 garageName, garageCode, pvr, headwayMin } },
 *     aliases:     { "N128": "128", ... },
 *     operatorByRoute: { "128": "Stagecoach London", ... },
 *     operatorByRouteBustimes: {}  // kept as empty object for compat
 *   }
 *
 * Run: npm run fetch-route-details
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'data');
const OUT_PATH  = path.join(DATA_DIR, 'source', 'route_details.json');
const GARAGES_PATH = path.join(DATA_DIR, 'garages.geojson');
const DETAILS_URL  = 'http://www.londonbusroutes.net/details.htm';
const TIMEOUT_MS   = 30_000;

// ── Normalise operators to parent brands ──────────────────────────────────────
const OPERATOR_ALIASES = {
  'Arriva': 'Arriva',
  'Go-Ahead': 'Go-Ahead',
  'Metroline': 'Metroline',
  'Stagecoach': 'Stagecoach London',
  'Stagecoach London': 'Stagecoach London',
  'Transport UK': 'Transport UK',
  'First': 'First',
  'First Bus': 'First',
  'Uno': 'Uno',
  'Sullivan Buses': 'Sullivan Buses',
};
function normaliseOperator(name) {
  if (!name) return null;
  const t = String(name).trim();
  return OPERATOR_ALIASES[t] ?? t;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'london-buses-map/2.0' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Detect encoding: details.htm sometimes serves Windows-1252.
    const buf = Buffer.from(await res.arrayBuffer());
    // Try UTF-8 strict; if replacement chars (U+FFFD) appear, fall back to Latin-1.
    let txt = buf.toString('utf8');
    if (txt.includes('\uFFFD')) txt = buf.toString('latin1');
    return txt;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── 1. Load authoritative garage → route allocation from garages.geojson ────
function loadGarageAllocation() {
  if (!fs.existsSync(GARAGES_PATH)) {
    console.warn(`  data/garages.geojson not found — operator/garage/PVR will be empty. Run fetch-garages first.`);
    return { byRoute: {}, garageByCode: {} };
  }
  const data = JSON.parse(fs.readFileSync(GARAGES_PATH, 'utf8'));
  const byRoute = {};       // { "1": { operator, garageName, garageCode, pvr, nightOnly } }
  const garageByCode = {};  // { "Q": { operator, garageName, pvr } }
  for (const f of (data.features ?? [])) {
    const p = f.properties ?? {};
    const code = String(p['TfL garage code'] || p['LBR garage code'] || '').trim().toUpperCase();
    if (!code) continue;
    const operator   = normaliseOperator(p['Group name']);
    const garageName = p['Garage name'] ?? null;
    const pvr        = parseInt(p['PVR'], 10);
    garageByCode[code] = { operator, garageName, pvr: Number.isFinite(pvr) ? pvr : null };

    const register = (tokens, { nightOnly = false, school = false } = {}) => {
      for (const raw of tokens.split(/\s+/)) {
        const t = raw.trim().toUpperCase();
        if (!t) continue;
        // Existing entry from main list wins over night-only/school-only
        const prev = byRoute[t];
        if (prev && !prev.nightOnly && !prev.schoolOnly) continue;
        if (prev && nightOnly && !prev.nightOnly) continue;
        byRoute[t] = {
          operator, garageName, garageCode: code,
          pvr: Number.isFinite(pvr) ? pvr : null,
          nightOnly, schoolOnly: school,
        };
      }
    };
    register(p['TfL main network routes'] || '', {});
    register(p['TfL night routes']        || '', { nightOnly: true });
    register(p['TfL school/mobility routes'] || '', { school: true });
  }
  console.log(`  Loaded ${Object.keys(byRoute).length} route→garage mappings from garages.geojson`);
  return { byRoute, garageByCode };
}

// ── 2. details.htm — vehicle type strings per route ─────────────────────────
// Robust regex-based parse (no fixed columns). The page has <pre> blocks like:
//   "  1  B5LH/Gemini 3 2D              Q   23  14  9  46-96   9-10     13      13    06/07/24 TQ 7 30/09/23"
// Structure after stripping inline <a>/<font> tags and &entities:
//   route-id  vehicle-type(>=3 tokens, includes spaces)  garage-code  ... numbers ...
// We anchor on: ^spaces?ROUTE  spaces(2+)  VEHICLE(greedy-until-2-spaces-then-CODE)  CODE=[A-Z0-9]{1,4}  2+spaces  digits

function stripInlineTags(s) {
  return s
    .replace(/<a [^>]*>([^<]*)<\/a>/gi, '$1')
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/<\/?b>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function parseDetailsText(html) {
  // Collect <pre>…</pre> blocks
  const preBlocks = [];
  const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let m;
  while ((m = preRe.exec(html)) !== null) preBlocks.push(m[1]);
  if (!preBlocks.length) throw new Error('No <pre> blocks in details.htm');

  // The table uses fixed-width columns defined by a dash-separator header line:
  //   ---- ----------------------------- --- --- -- -- ------- ------- ------- ------- -------- -- - --------
  //   Rte  Vehicle Type                  Op. PVR     Length          Frequencies       Timetable   Contract
  //   nr.                                Gar.    km mi minutes Mon-Sat Sunday  evening   date   specification
  // Column layout (0-indexed, inclusive ranges):
  //   0-3   route id
  //   5-33  vehicle type (29 chars)
  //   35-37 garage/op code
  //   39-41 PVR
  //   43-44 km
  //   46-47 mi
  //   49-55 range (min-max minutes)
  //   57-63 Mon-Sat headway
  //   65-71 Sunday headway
  //   73-79 evening headway
  //   81-88 timetable date
  //   90-?  contract spec
  const COLS = {
    route:   [ 0,  4],
    vehicle: [ 5, 34],
    garage:  [35, 38],
    pvr:     [39, 42],
    km:      [43, 45],
    mi:      [46, 48],
    range:   [49, 56],
    monSat:  [57, 64],
    sunday:  [65, 72],
    evening: [73, 80],
  };
  function slice(line, [a, b]) {
    return line.slice(a, b).trim();
  }

  // Parse one headway cell. Examples:
  //   "12"   → 12          (single number)
  //   "8-9"  → 8.5         (range, take mean)
  //   "12*"  → 12          (footnote markers stripped)
  //   ""     → null        (empty)
  //   "WCroydon" → null    (school routes put endpoint names here, not numbers)
  function parseHeadwayCell(s) {
    if (!s) return null;
    const c = String(s).replace(/[*†‡§·]+/g, '').trim();
    if (!c) return null;
    let m;
    if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(c))) return (parseInt(m[1], 10) + parseInt(m[2], 10)) / 2;
    if ((m = /^(\d+)$/.exec(c))) return parseInt(m[1], 10);
    return null;
  }

  // Representative weekday headway for a row. Daytime routes carry it directly
  // in the Mon-Sat / Sunday / evening fixed-width columns. Night routes leave
  // those columns empty and put the night headways just before the date — fall
  // back to tokenising the segment after the length-range column. School /
  // limited-service routes encode endpoint names in the headway columns; we
  // detect alpha chars there and return null so they don't get a spurious band.
  function representativeHeadway(line) {
    const headwayWindow = line.length > 57 ? line.slice(57, 80) : '';
    if (/[A-Za-z]/.test(headwayWindow)) return null;
    const monSat  = parseHeadwayCell(slice(line, COLS.monSat));
    const sunday  = parseHeadwayCell(slice(line, COLS.sunday));
    const evening = parseHeadwayCell(slice(line, COLS.evening));
    for (const v of [monSat, sunday, evening]) if (v != null && v > 0) return v;
    const dateMatch = /\b\d{2}\/\d{2}\/\d{2}\b/.exec(line);
    if (!dateMatch || line.length < 39) return null;
    const segment = line.slice(39, dateMatch.index);
    const tokens = [...segment.matchAll(/(?<![A-Za-z])(\d+(?:-\d+)?)\*?(?![A-Za-z])/g)];
    const vals = tokens.map(t => parseHeadwayCell(t[1])).filter(v => v != null);
    return vals.length > 4 ? vals[4] : null;
  }

  const byRoute = {};

  for (const block of preBlocks) {
    const rawLines = block.split(/\r?\n/);
    for (const raw of rawLines) {
      const line = stripInlineTags(raw);
      if (!line.trim()) continue;
      if (/^\s*(Rte|nr\.|Route|Vehicle|Number|---)/i.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;                 // footnote
      if (/^\s*Contract/i.test(line)) continue;

      // Route id must live in the first 4 chars
      const routeCol = slice(line, COLS.route);
      if (!routeCol) continue;
      if (!/^[A-Z]{0,3}\d{1,3}[A-Z]?$|^[A-Z]{2,4}$/.test(routeCol)) continue;
      const rid = routeCol.toUpperCase();
      if (byRoute[rid]) continue; // first occurrence wins

      const vehicleRaw = slice(line, COLS.vehicle);
      const garageRaw  = slice(line, COLS.garage).replace(/\*+$/, '').toUpperCase();
      const pvrRaw     = slice(line, COLS.pvr);
      const pvrNum = parseInt(pvrRaw, 10);
      byRoute[rid] = {
        vehicleType: vehicleRaw,
        garageCodeFromDetails: /^[A-Z0-9]{1,4}$/.test(garageRaw) ? garageRaw : null,
        pvrFromDetails: Number.isFinite(pvrNum) ? pvrNum : null,
        headwayMinFromDetails: representativeHeadway(line),
      };
    }
  }
  return byRoute;
}

// ── Vehicle-string → deck / propulsion heuristics ────────────────────────────
function deriveDeck(s) {
  if (!s) return null;
  const t = s.toUpperCase();
  if (/\b3D\b/.test(t) || /\b2D\b/.test(t)) return 'double';
  if (/\b1D\b/.test(t)) return 'single';
  if (/NEW BUS FOR LONDON/.test(t) || /E40H/.test(t) || /ENVIRO400/.test(t) ||
      /B5LH/.test(t) || /B5TH/.test(t) || /GEMINI/.test(t) || /EVOSETI/.test(t) ||
      /METRODECKER/.test(t) || /STREETDECK/.test(t)) return 'double';
  if (/ENVIRO200/.test(t) || /\bE200\b/.test(t) || /CITARO/.test(t) ||
      /SOLO/.test(t) || /VERSA/.test(t) || /STREETLITE/.test(t) ||
      /YUTONG/.test(t) || /VOLVO B[78]RLE/.test(t) || /\bE10\b|\bE12\b/.test(t)) return 'single';
  return null;
}
function derivePropulsion(s) {
  if (!s) return null;
  const t = s.toUpperCase();
  if (/FCEV|FUEL CELL|HYDROGEN/.test(t)) return 'hydrogen';
  if (/\bEV\b|EV |\bE\d{1,2}[A-Z]?EV\b|[A-Z0-9]EV\b|ELECTROLINER|STREETAIR|ELECTRIC|ECITARO|\bZEB\b|\bBYD\b|\bBZL\b/.test(t)) return 'electric';
  if (/YUTONG\s+E\d/.test(t)) return 'electric';
  if (/NEW BUS FOR LONDON|NB4L|ENVIRO400H|E40H|B5LH|B5TH|\bHEV\b|HYBRID/.test(t)) return 'hybrid';
  return 'diesel';
}
function cleanVehicleType(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/[*†‡§\u0086]+$/g, '').trim();         // trailing footnote markers
  s = s.replace(/^[A-Z0-9]{3,5}\s+(?=\d|\(|[A-Z])/, ''); // strip fleet prefix (E20D, B5LH...) when followed by size/body
  s = s.replace(/\s*\d+\.?\d*m\//i, '/').trim();        // collapse "10.5m/" into "/"
  s = s.replace(/^\/+/, '').trim();
  s = s.replace(/\s*[123]D[?*†‡§\u0086]?\s*$/, '').trim(); // strip trailing deck tag
  return s || null;
}

// ── 3. Service types from TfL (for aliases of 24-hour routes) ────────────────
try {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}
const API_KEY = process.env.BUS_API_KEY ?? '';

// Aliases (night→day) come from routes.htm — preserve old behaviour.
async function fetchAliases() {
  try {
    const html = await fetchText('http://www.londonbusroutes.net/routes.htm');
    const rowRe = /<TR[^>]*>\s*<TD[^>]*>\s*<a\s+name=["']?([MN][A-Z0-9]+)["']?\s+href=["']?([^"'>]+)["']?>([^<]+)<\/a>/gi;
    const rows = [];
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      rows.push({ role: m[1][0], id: (m[1][0] === 'N' ? m[1].slice(1) : m[3]).trim().toUpperCase(), href: m[2].trim() });
    }
    const byHref = {};
    for (const r of rows) (byHref[r.href] ??= []).push(r);
    const aliases = {};
    for (const r of rows) {
      if (r.role !== 'N') continue;
      const main = byHref[r.href].find(x => x.role === 'M');
      if (main) aliases[`N${r.id}`] = main.id;
    }
    return aliases;
  } catch (err) {
    console.warn(`  routes.htm unavailable (${err.message}) — aliases empty`);
    return {};
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading garage allocations from data/garages.geojson...');
  const { byRoute: allocByRoute, garageByCode } = loadGarageAllocation();

  console.log(`Fetching ${DETAILS_URL}...`);
  let detailsHtml = '';
  try {
    detailsHtml = await fetchText(DETAILS_URL);
    console.log(`  Downloaded ${(detailsHtml.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.warn(`  details.htm unavailable (${err.message}) — vehicle types will be null`);
  }
  const vehicleByRoute = detailsHtml ? parseDetailsText(detailsHtml) : {};
  console.log(`  Parsed vehicle info for ${Object.keys(vehicleByRoute).length} routes`);

  const aliases = await fetchAliases();
  console.log(`  Parsed ${Object.keys(aliases).length} night→day aliases`);

  // Build per-route output
  const routes = {};
  const operatorByRoute = {};
  const allIds = new Set([...Object.keys(allocByRoute), ...Object.keys(vehicleByRoute)]);
  for (const id of allIds) {
    const alloc = allocByRoute[id] ?? null;
    const v = vehicleByRoute[id] ?? null;
    const rawVehicle = v?.vehicleType ?? null;
    const cleanVeh = cleanVehicleType(rawVehicle);
    // Cross-check garage code: if details.htm gave a different one, trust the CSV
    let operator = alloc?.operator ?? null;
    let garageName = alloc?.garageName ?? null;
    let garageCode = alloc?.garageCode ?? null;
    // Route-level PVR comes from details.htm (per route). The garages CSV PVR is
    // a garage-wide total and must NOT be written to each route or it multiplies
    // when summed. Garage totals belong on the garage record, not the route.
    let pvr = v?.pvrFromDetails ?? null;
    if (!alloc && v?.garageCodeFromDetails) {
      garageCode = v.garageCodeFromDetails;
      const g = garageByCode[garageCode];
      if (g) {
        operator = g.operator;
        garageName = g.garageName;
      }
    }
    routes[id] = {
      deck:        deriveDeck(rawVehicle),
      vehicleType: cleanVeh,
      propulsion:  derivePropulsion(rawVehicle),
      operator, garageName, garageCode, pvr,
      // Representative weekday headway (minutes) read straight from the
      // details.htm row. Used by build-classifications.js as a fallback
      // signal when TfL's published timetable yields no band.
      headwayMin:  v?.headwayMinFromDetails ?? null,
    };
    if (operator) operatorByRoute[id] = operator;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'garages.geojson + londonbusroutes.net/details.htm',
    routeCount: Object.keys(routes).length,
    routes,
    aliases,
    operatorByRoute,
    operatorByRouteBustimes: {},
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`Wrote: ${OUT_PATH}`);
  console.log(`  Routes: ${output.routeCount}`);
  // Spot-check
  if (routes['1']) {
    const r = routes['1'];
    console.log(`  Route 1: vehicle=${r.vehicleType} operator=${r.operator} garage=${r.garageCode} (${r.garageName}) pvr=${r.pvr}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
