/**
 * fetch-stops.js — TfL bus StopPoint export
 *
 * Ports RouteMapster's fetch_bus_stops.py (without postcode reverse-geocoding —
 * TfL's Postcode additionalProperty is used when present; stops without it are
 * still emitted, just without a POSTCODE property).
 *
 * Outputs:
 *   data/stops.geojson          — all roadside bus stops
 *
 * Run: npm run fetch-stops
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'data');
const OUT_STOPS    = path.join(DATA_DIR, 'stops.geojson');
const BASE_URL  = 'https://api.tfl.gov.uk';

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

function apiUrl(ep, params = {}) {
  const u = new URL(BASE_URL + ep);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (API_KEY) u.searchParams.set('app_key', API_KEY);
  return u.toString();
}

async function fetchJson(url, retries = 4) {
  for (let i = 1; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, i * 800));
    }
  }
}

function addlProp(sp, key) {
  const k = key.toLowerCase();
  for (const ap of (sp.additionalProperties ?? [])) {
    if ((ap.key ?? '').toLowerCase() === k) return ap.value;
  }
  return null;
}

function extractStopLetter(sp) {
  const cands = [
    sp.indicator, sp.stopLetter, sp.stop_letter,
    addlProp(sp, 'Indicator'), addlProp(sp, 'StopLetter'), addlProp(sp, 'Stop Letter'),
  ];
  for (const c of cands) {
    if (c == null) continue;
    let t = String(c).trim().toUpperCase().replace(/\./g, ' ');
    if (t.startsWith('STOP ')) t = t.slice(5).trim();
    const tok = t.split(/\s+/)[0] ?? '';
    if (!tok || tok.startsWith('->')) continue;
    if (['OPP','ADJ','NR','O/S','STAND'].includes(tok)) continue;
    if (tok.endsWith('-BOUND') || ['NORTHBOUND','SOUTHBOUND','EASTBOUND','WESTBOUND'].includes(tok)) continue;
    if (/^[A-Z]{1,2}\d?$/.test(tok)) return tok;
  }
  return null;
}

function isBusStop(sp) {
  const st = (sp.stopType ?? '').trim();
  const modes = sp.modes ?? [];
  return st === 'NaptanPublicBusCoachTram' && modes.includes('bus');
}

function normaliseRoute(id) {
  if (!id) return null;
  const t = String(id).trim().toUpperCase();
  return t || null;
}

function extractRoutes(sp) {
  const out = new Set();
  for (const line of (sp.lines ?? [])) {
    const r = normaliseRoute(line.id ?? line.name);
    if (r) out.add(r);
  }
  return [...out].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

async function fetchAllStops() {
  const stops = [];
  const seen = new Set();
  let page = 1, empties = 0;
  while (page <= 500) {
    const payload = await fetchJson(apiUrl('/StopPoint/Mode/bus', { page }));
    const batch = Array.isArray(payload) ? payload : (payload.stopPoints ?? []);
    let added = 0;
    for (const sp of batch) {
      const id = sp.naptanId ?? sp.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      stops.push(sp);
      added++;
    }
    console.log(`  page ${page}: +${added} (total ${stops.length})`);
    if (added === 0) {
      empties++;
      if (empties >= 1) break;
    } else {
      empties = 0;
    }
    page++;
    await new Promise(r => setTimeout(r, 50));
  }
  return stops;
}

function buildStopFeature(sp) {
  const id = sp.naptanId ?? sp.id;
  const name = sp.commonName ?? sp.name;
  const { lat, lon } = sp;
  if (!id || !name || lat == null || lon == null) return null;
  const routes = extractRoutes(sp);
  const postcode = addlProp(sp, 'Postcode') ?? addlProp(sp, 'postcode');
  const borough  = addlProp(sp, 'Borough')  ?? addlProp(sp, 'borough');
  const props = {
    NAPTAN_ID: String(id),
    NAME: String(name),
    POSTCODE: postcode ? String(postcode).trim() : '',
    ROUTES: routes.join(', '),
    URL: `https://tfl.gov.uk/bus/stop/${id}/`,
  };
  const letter = extractStopLetter(sp);
  if (letter) props.STOP_LETTER = letter;
  if (borough) props.BOROUGH = String(borough).trim();
  if (sp.topMostParentId) props.TOPMOST_PARENT_ID = String(sp.topMostParentId);
  if (sp.parentId)        props.PARENT_ID         = String(sp.parentId);
  if (sp.stopAreaId)      props.STOP_AREA_ID      = String(sp.stopAreaId);
  if (sp.stationId)       props.STATION_ID        = String(sp.stationId);
  // Prune empty values
  for (const k of Object.keys(props)) if (!props[k]) delete props[k];
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
    properties: props,
  };
}

async function main() {
  console.log('Fetching all TfL bus StopPoints...');
  const raw = await fetchAllStops();
  console.log(`  Fetched ${raw.length} raw StopPoints`);

  const features = [];
  let dropped = 0;
  for (const sp of raw) {
    if (!isBusStop(sp)) { dropped++; continue; }
    const f = buildStopFeature(sp);
    if (f) features.push(f);
  }
  features.sort((a, b) => (a.properties.NAPTAN_ID).localeCompare(b.properties.NAPTAN_ID));
  const stopsFc = { type: 'FeatureCollection', features };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_STOPS, JSON.stringify(stopsFc), 'utf8');
  console.log(`Wrote ${features.length} stops to ${OUT_STOPS} (dropped ${dropped} non-bus)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
