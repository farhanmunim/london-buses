/**
 * fetch-route-details.js — Scrape supplementary route data
 *
 * Fetches route data from londonbusroutes.net:
 *   details.htm  — fixed-width text table: vehicle type, garage code, PVR, frequencies
 *   garages.htm  — HTML table: garage code → operator name + garage name
 *
 * Data not available from the official bus API:
 *   - Vehicle type (single / double deck)
 *   - Propulsion (electric / hydrogen / hybrid / diesel)
 *   - Operator name
 *   - Garage name
 *   - PVR (peak vehicle requirement)
 *   - Frequency headways (weekday, Sunday, evening)
 *
 * Output (written to data/source/route_details.json):
 *   { routes: { [routeId]: { deck, vehicleType, propulsion, operator, garageName,
 *                             garageCode, pvr, freqWeekday, freqSunday, freqEvening } } }
 *
 * Run: npm run fetch-route-details
 *      (also called automatically by npm run refresh)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH   = path.resolve(__dirname, '../data/source/route_details.json');
const TIMEOUT_MS = 20_000;

// ── Column offsets in the fixed-width <pre> table (0-indexed, confirmed empirically) ──
// Dash line: "---- ----------------------------- --- --- -- -- ------- ------- ------- ------- -------- -- - --------"
const COL = {
  routeEnd:   4,   // slice(0, 4)
  vehicleEnd: 34,  // slice(5, 34)
  garageEnd:  38,  // slice(35, 38) → garage/op code
  pvrEnd:     42,  // slice(39, 42)
  monSatEnd:  64,  // slice(57, 64)
  sunEnd:     72,  // slice(65, 72)
  eveEnd:     80,  // slice(73, 80)
};

// ── HTML utility ──────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g,  '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; route-data-collector/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Routes page parser ───────────────────────────────────────────────────────
//
// routes.htm has one row per (routeId, role) pair. Anchor names are `M<id>`
// for the daytime table and `N<id>` for the night table. Rows sharing the
// same `href="times/<filename>.htm"` belong to the same physical service —
// meaning a night row whose href matches a main row is an alias of that
// main route (a 24-hour service branded under two numbers).
//
// Returns:
//   aliases:   { 'N128': '128', 'N277': '30', ... }  — night → daytime mapping
//   operators: { '128': 'Stagecoach London', ... }   — operator from the 3rd <TD>
//
// Operator names on routes.htm are the legal subsidiary (e.g. "Arriva London",
// "London General", "Blue Triangle") — we normalise them to the parent brands
// used elsewhere in the app (Arriva, Go-Ahead, etc.).

const OPERATOR_ALIASES = {
  'Arriva London':          'Arriva',
  'Metroline West':          'Metroline',
  'Metroline West Ltd.':     'Metroline',
  'Metroline Travel':        'Metroline',
  'First Bus London':        'First',
  'First Bus':               'First',
  'London General':          'Go-Ahead',
  'London Central':          'Go-Ahead',
  'Go-Ahead London':         'Go-Ahead',
  'Blue Triangle':           'Go-Ahead',
  'Abellio London':          'Transport UK',
  'Transport UK London Bus': 'Transport UK',
  'Stagecoach East London':  'Stagecoach London',
  'Stagecoach Selkent':      'Stagecoach London',
};
function normaliseOperator(name) {
  if (!name) return null;
  const trimmed = name.replace(/\s*Ltd\.?$/, '').trim();
  return OPERATOR_ALIASES[trimmed] ?? trimmed;
}

async function fetchRouteAliasesAndOperators() {
  console.log('Fetching route alias map (routes.htm)...');
  let html;
  try {
    html = await fetchText('http://www.londonbusroutes.net/routes.htm');
  } catch (err) {
    console.warn(`  Warning: could not fetch routes.htm (${err.message}) — skipping alias inference`);
    return { aliases: {}, operators: {} };
  }

  const rows = [];
  const rowRe = /<TR[^>]*>\s*<TD[^>]*>\s*<a\s+name=["']?([MN][A-Z0-9]+)["']?\s+href=["']?([^"'>]+)["']?>([^<]+)<\/a>\s*<\/TD>\s*<TD[^>]*>([^<]*)<\/TD>\s*<TD[^>]*>([^<]*)<\/TD>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const [, anchor, href, label, _dest, operator] = m;
    const role    = anchor[0];                // 'M' or 'N'
    const routeId = label.trim().toUpperCase();
    if (!routeId) continue;
    // Night-table rows show the daytime id in the label (e.g. anchor N128 → label "128").
    // So the actual route id for an N-row is the anchor number.
    const realId = role === 'N' ? anchor.slice(1).toUpperCase() : routeId;
    rows.push({ role, id: realId, href: href.trim(), operator: normaliseOperator(operator.trim()) });
  }

  // Group by href to find aliases
  const byHref = {};
  for (const r of rows) (byHref[r.href] ??= []).push(r);
  const aliases  = {};
  const operators = {};
  for (const r of rows) {
    // Night row: if a main-row in the same group exists, record alias
    if (r.role === 'N') {
      const group = byHref[r.href];
      const main  = group.find(x => x.role === 'M');
      const nightId = `N${r.id}`;
      if (main) aliases[nightId] = main.id;
      if (r.operator) operators[nightId] = r.operator;
    } else {
      if (r.operator) operators[r.id] = r.operator;
    }
  }
  console.log(`  Parsed routes.htm: ${rows.length} rows, ${Object.keys(aliases).length} night→day aliases, ${Object.keys(operators).length} operator entries`);
  return { aliases, operators };
}

// ── Step 1: Parse garages page → garage code lookup ──────────────────────────

async function fetchGarageLookup() {
  console.log('Fetching garage/operator list...');
  const html = await fetchText('http://www.londonbusroutes.net/garages.htm');
  console.log(`  Downloaded ${(html.length / 1024).toFixed(0)} KB`);

  const lookup = {}; // garageCode → { operator, garageName }
  let currentOp = null;

  const trRe = /<TR[^>]*>([\s\S]*?)<\/TR>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const row = m[1];

    // Operator header row: <TH colspan=4> containing operator name
    if (/colspan=['"']?4/i.test(row) && /<TH/i.test(row)) {
      const thM = row.match(/<TH[^>]*>([\s\S]*?)<\/TH>/i);
      if (thM) {
        const name = stripHtml(thM[1]).replace(/\s*\d[\d.%()\s]*$/, '').trim();
        if (name && !/^\d/.test(name)) currentOp = name;
      }
      continue;
    }

    // Garage row: TH with <a name="CODE"> anchor
    const codeM = row.match(/<a\s+name=['"']?([A-Z0-9]{1,4})['"']?/i);
    if (!codeM || !currentOp) continue;

    const cells = [];
    const tdRe = /<T[DH][^>]*>([\s\S]*?)<\/T[DH]>/gi;
    let cm;
    while ((cm = tdRe.exec(row)) !== null) cells.push(stripHtml(cm[1]));

    const code = codeM[1].toUpperCase();
    const garageName = cells[1]?.trim() || '';
    if (code && garageName) lookup[code] = { operator: currentOp, garageName };
  }

  console.log(`  Parsed ${Object.keys(lookup).length} garage entries`);
  return lookup;
}

// ── Step 2: Derived fields from vehicle type string ───────────────────────────

function deriveDeck(vehicleStr) {
  const t = vehicleStr.toUpperCase();
  if (/\b3D\b/.test(t) || /\b2D\b/.test(t)) return 'double';
  if (/\b1D\b/.test(t)) return 'single';
  // Named single-deck models (no deck suffix)
  const singles = ['ENVIRO200', 'E200', 'CITARO', 'SOLO', 'VERSA', 'STREETLITE',
    'CAETANO', 'E12\b', 'E10\b', 'E9\b', 'YUTONG', 'VOLVO B7RLE', 'VOLVO B8RLE'];
  if (singles.some(k => new RegExp(k).test(t))) return 'single';
  return null;
}

/**
 * Derive propulsion type from vehicle type string.
 * Returns: 'electric' | 'hydrogen' | 'hybrid' | 'diesel'
 */
function derivePropulsion(vehicleStr) {
  if (!vehicleStr) return null;
  const t = vehicleStr.toUpperCase();

  // Hydrogen fuel cell
  if (t.includes('FCEV') || t.includes('FUEL CELL') || t.includes('HYDROGEN')) return 'hydrogen';

  // Battery electric (various naming conventions)
  if (
    /\bEV\b/.test(t) ||           // standalone EV
    t.includes('EV ') ||           // "EV City", "EV 2D"
    /[A-Z0-9]EV\b/.test(t) ||     // "Enviro400EV", "MetroDecker EV"
    t.includes('ELECTROLINER') ||
    t.includes('STREETAIR') ||
    t.includes('ELECTRIC') ||
    t.includes('ECITARO') ||
    t.includes('ZEB') ||
    t.includes('BYD') ||
    /YUTONG\s+E\d/.test(t) ||     // "Yutong E12" etc
    /\bE\d{1,2}M?\b/.test(t)      // "E12", "E10" etc
  ) return 'electric';

  // Diesel-electric hybrid
  if (
    t.includes('NEW BUS FOR LONDON') ||
    t.includes('NB4L') ||
    /ENVIRO400H/.test(t) ||        // ADL Enviro400H hybrid
    t.includes('E40H') ||          // fleet code for Enviro400H
    t.includes('B5LH') ||          // Volvo B5LH hybrid
    t.includes('B5TH') ||          // Volvo B5TH hybrid
    t.includes('HEV') ||
    t.includes('HYBRID')
  ) return 'hybrid';

  return 'diesel';
}

function cleanVehicleType(raw) {
  if (!raw) return null;
  let s = raw.trim();
  // Remove fleet code prefix (e.g. "E40H ", "B5LH ")
  s = s.replace(/^[A-Z0-9]{3,5}\s+/, '');
  // Remove length measurement (e.g. "10.2m/")
  s = s.replace(/\d+\.?\d*m\//i, '');
  // Strip deck suffixes (deck is stored separately)
  s = s.replace(/\s*[123]D$/, '');
  return s.trim() || null;
}

// ── Step 3: Parse fixed-width frequency headways ──────────────────────────────

function parseHeadway(cell) {
  const s = cell.replace(/[*†‡]/g, '').trim();
  if (!s || /^[-–]$/.test(s)) return null;
  // Take the first run of digits (handles "9-10", "20 20", "10*" etc.)
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Reject obviously wrong values (no real route has >90 min headway)
  return n > 90 ? null : n;
}

// ── Step 4: Parse all fixed-width <pre> blocks ───────────────────────────────
// The page has 4 <pre> blocks: day routes (×2 sections), night routes, school routes.
// All share the same column layout for route ID / vehicle / garage / PVR.

function parseDetailsPage(html) {
  // Extract every <pre>…</pre> block on the page
  const blocks = [];
  let idx = 0;
  while (true) {
    const start = html.indexOf('<pre>', idx);
    if (start < 0) break;
    const end = html.indexOf('</pre>', start);
    const raw = html.slice(start, end)
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g,  '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, '');
    blocks.push(raw);
    idx = end + 1;
  }
  if (!blocks.length) throw new Error('No <pre> blocks found on details page');

  const dataLines = [];
  for (const text of blocks) {
    for (const line of text.split(/\r?\n/)) {
      if (/^[-\s]*$/.test(line)) continue;
      if (/^\s*(Rte|nr\.|Route|Vehicle|Number)/i.test(line)) continue;
      const routeStr = line.slice(0, COL.routeEnd).trim();
      if (!routeStr) continue;
      // Accept: numeric (1-999), N-prefix (N1, N279), letter-prefix with digit (A10, EL1, W7),
      // and letter-only codes (SCS, RV1, etc.)
      if (
        !/^N?\d{1,4}[A-Z0-9]*$/.test(routeStr)      &&
        !/^[A-Z]{1,3}\d{1,3}[A-Z0-9]*$/.test(routeStr) &&
        !/^[A-Z]{2,4}$/.test(routeStr)
      ) continue;
      dataLines.push(line);
    }
  }
  return dataLines;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching route details...');

  // Step 1 — garage lookup (graceful fallback)
  let garageLookup = {};
  try {
    garageLookup = await fetchGarageLookup();
  } catch (err) {
    console.warn(`  Warning: could not fetch garage list (${err.message}) — operator/garage names will be omitted`);
  }

  // Step 1b — route aliases + fallback operator map from routes.htm
  const { aliases, operators: operatorByRoute } = await fetchRouteAliasesAndOperators();

  // Step 2 — details page
  let html;
  try {
    const url = 'http://www.londonbusroutes.net/details.htm';
    console.log(`Fetching ${url}...`);
    html = await fetchText(url);
    console.log(`  Downloaded ${(html.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    if (fs.existsSync(OUT_PATH)) {
      console.warn(`Warning: could not fetch route details (${err.message}) — keeping existing cache`);
      process.exit(0);
    }
    throw new Error(`Could not fetch route details and no cache exists: ${err.message}`);
  }

  const dataLines = parseDetailsPage(html);
  console.log(`  Data lines extracted: ${dataLines.length}`);

  // Step 3 — parse each line
  const routes = {};
  let parsed = 0, skipped = 0;

  for (const line of dataLines) {
    const routeId    = line.slice(0, COL.routeEnd).trim().toUpperCase();
    const vehicleRaw = line.slice(5, COL.vehicleEnd).trim();
    const garageCode = line.slice(35, COL.garageEnd).trim().replace(/[*†‡]/g, '').toUpperCase();
    const pvrRaw     = line.slice(39, COL.pvrEnd).trim();
    const monSatRaw  = line.length > 57 ? line.slice(57, COL.monSatEnd).trim() : '';
    const sundayRaw  = line.length > 65 ? line.slice(65, COL.sunEnd).trim()    : '';
    const eveningRaw = line.length > 73 ? line.slice(73, COL.eveEnd).trim()    : '';

    if (!routeId || routeId.length > 6) { skipped++; continue; }

    const deck        = deriveDeck(vehicleRaw);
    const vehicleType = cleanVehicleType(vehicleRaw);
    const propulsion  = derivePropulsion(vehicleRaw);
    const pvr         = parseInt(pvrRaw, 10) || null;
    const freqWeekday = parseHeadway(monSatRaw);
    const freqSunday  = parseHeadway(sundayRaw);
    const freqEvening = parseHeadway(eveningRaw);

    const garageInfo  = garageLookup[garageCode] ?? null;
    const operator    = garageInfo?.operator  ?? null;
    const garageName  = garageInfo?.garageName ?? null;

    routes[routeId] = {
      deck, vehicleType, propulsion,
      operator, garageName, garageCode: garageCode || null,
      pvr, freqWeekday, freqSunday, freqEvening,
    };
    parsed++;
  }

  console.log(`  Parsed: ${parsed} routes, skipped: ${skipped} lines`);

  // Summary stats
  const deckCounts = {
    double:  Object.values(routes).filter(r => r.deck === 'double').length,
    single:  Object.values(routes).filter(r => r.deck === 'single').length,
    unknown: Object.values(routes).filter(r => r.deck === null).length,
  };
  const propCounts = {};
  for (const r of Object.values(routes)) {
    const p = r.propulsion ?? 'unknown';
    propCounts[p] = (propCounts[p] ?? 0) + 1;
  }
  const opCounts = {};
  for (const r of Object.values(routes)) {
    const o = r.operator ?? 'unknown';
    opCounts[o] = (opCounts[o] ?? 0) + 1;
  }
  console.log('  Deck:', deckCounts);
  console.log('  Propulsion:', propCounts);
  console.log('  Operators:', opCounts);

  const output = {
    generatedAt: new Date().toISOString(),
    source:      'londonbusroutes.net',
    routeCount:  parsed,
    routes,
    aliases,           // { 'N128': '128', ... } — night routes that are 24-hour aliases
    operatorByRoute,   // { '128': 'Stagecoach London', ... } — tertiary operator source
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`Written: ${OUT_PATH}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
