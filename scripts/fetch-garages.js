/**
 * fetch-garages.js — Garage GeoJSON from londonbusroutes.net/garages.csv
 *
 * Downloads the authoritative garages CSV and converts it to a GeoJSON
 * FeatureCollection, geocoding each garage by its UK postcode via postcodes.io
 * (bulk, no API key). Uses reference/data/garages-base.geojson (or an existing
 * data/garages.geojson) as the base for geometry when a garage already has
 * known coordinates, preserving manual fixes.
 *
 * Also mirrors the RouteMapster "route hygiene" fix: numeric night routes are
 * copied into the main-network field.
 *
 * Output: data/garages.geojson
 * Run: npm run fetch-garages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'garages.geojson');
const BASE_PATH_REF = path.join(ROOT, 'reference', 'data', 'garages-base.geojson');
const BASE_PATH_EXISTING = OUT_PATH;
const CACHE_PATH = path.join(DATA_DIR, 'source', 'geocode_cache.json');

const GARAGES_CSV_URL = 'http://www.londonbusroutes.net/garages.csv';
const POSTCODES_URL   = 'https://api.postcodes.io/postcodes';

// ── Minimal CSV parser (handles quotes and doubled quotes) ───────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ',') { row.push(field); field = ''; i++; }
      else if (c === '\r') { i++; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
      else { field += c; i++; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.some(v => v && v.trim())).map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
function extractPostcode(addr) {
  if (!addr) return null;
  const m = addr.match(POSTCODE_RE);
  if (!m) return null;
  const pc = m[1].toUpperCase().replace(/\s+/g, '');
  return pc.slice(0, -3) + ' ' + pc.slice(-3);
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}
function saveCache(c) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(c), 'utf8');
}

async function bulkLookup(postcodes) {
  const res = await fetch(POSTCODES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postcodes }),
  });
  if (!res.ok) throw new Error(`postcodes.io HTTP ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const item of (data.result ?? [])) {
    const q = item.query;
    if (!q) continue;
    const qn = q.toUpperCase().replace(/\s+/g, '');
    const key = qn.slice(0, -3) + ' ' + qn.slice(-3);
    out[key] = item.result ?? null;
  }
  return out;
}

function parseRouteTokens(v) {
  if (!v) return [];
  return String(v).split(/\s+/).map(t => t.trim().toUpperCase()).filter(Boolean);
}
function formatRoutes(tokens) {
  const uniq = [...new Set(tokens)].sort((a, b) => {
    const ai = /^\d+$/.test(a) ? [0, +a] : /^N\d+$/.test(a) ? [1, +a.slice(1)] : [2, 0];
    const bi = /^\d+$/.test(b) ? [0, +b] : /^N\d+$/.test(b) ? [1, +b.slice(1)] : [2, 0];
    if (ai[0] !== bi[0]) return ai[0] - bi[0];
    if (ai[0] < 2) return ai[1] - bi[1];
    return a.localeCompare(b);
  });
  return uniq.join(' ') + (uniq.length ? ' ' : '');
}

function loadExisting(p) {
  if (!fs.existsSync(p)) return { byCode: {}, unnamed: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const byCode = {}, unnamed = [];
    for (const f of (data.features ?? [])) {
      const props = f.properties ?? {};
      const code = String(props['TfL garage code'] || props['LBR garage code'] || '').trim().toUpperCase();
      if (code) byCode[code] = { properties: props, geometry: f.geometry };
      else unnamed.push({ properties: props, geometry: f.geometry });
    }
    return { byCode, unnamed };
  } catch { return { byCode: {}, unnamed: [] }; }
}

async function main() {
  console.log(`Downloading ${GARAGES_CSV_URL}...`);
  const res = await fetch(GARAGES_CSV_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csvText = await res.text();
  const rows = parseCsv(csvText);
  console.log(`  Parsed ${rows.length} garage rows`);

  // Route hygiene: copy numeric night routes into main
  for (const row of rows) {
    const main = new Set(parseRouteTokens(row['TfL main network routes']));
    const night = new Set(parseRouteTokens(row['TfL night routes']));
    for (const r of night) if (/^\d+$/.test(r)) main.add(r);
    row['TfL main network routes'] = formatRoutes([...main]);
    row['TfL night routes'] = formatRoutes([...night]);
  }

  // Merge base: reference base + existing output (existing wins over reference)
  const base = loadExisting(BASE_PATH_REF);
  const existing = loadExisting(BASE_PATH_EXISTING);
  const byCode = { ...base.byCode, ...existing.byCode };

  // Geocode uncached postcodes
  const cache = loadCache();
  const neededPcs = new Set();
  for (const row of rows) {
    const pc = extractPostcode(row['Garage address'] || row['Company address']);
    if (pc && !cache[pc] && !(byCode[String(row['TfL garage code'] || row['LBR garage code']).trim().toUpperCase()])) {
      neededPcs.add(pc);
    }
  }
  const needed = [...neededPcs];
  for (let i = 0; i < needed.length; i += 100) {
    const batch = needed.slice(i, i + 100);
    console.log(`  Geocoding batch ${i / 100 + 1} (${batch.length})...`);
    try {
      const results = await bulkLookup(batch);
      for (const pc of batch) {
        const r = results[pc];
        cache[pc] = r ? {
          lon: +r.longitude, lat: +r.latitude, postcode: r.postcode ?? pc,
          admin_district: r.admin_district, country: r.country,
        } : { _failed: true };
      }
      saveCache(cache);
    } catch (err) {
      console.warn(`    bulk lookup failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Build features
  const features = [];
  const GARAGE_PROPS = [
    'Group name','Company name','LBR garage code','Garage name','Garage address',
    'TfL main network routes','TfL night routes','TfL school/mobility routes','Other routes',
    'PVR','TfL garage code','Proportion of network',
  ];
  const ROUTE_FIELDS = new Set([
    'TfL main network routes','TfL night routes','TfL school/mobility routes','Other routes',
  ]);
  const UPDATE_FIELDS = new Set(['PVR','Proportion of network']);

  for (const row of rows) {
    const code = String(row['TfL garage code'] || row['LBR garage code'] || '').trim().toUpperCase();
    const ex = code ? byCode[code] : null;
    if (ex) {
      // Preserve geometry + existing non-route props; refresh route fields + PVR/%
      const props = { ...ex.properties };
      for (const k of ROUTE_FIELDS) props[k] = (row[k] ?? '').trim();
      for (const k of UPDATE_FIELDS) if (row[k] != null) props[k] = String(row[k]).trim();
      // Ensure core identity fields too
      for (const k of ['Group name','Company name','Garage name','LBR garage code','TfL garage code','Garage address']) {
        if (!props[k] && row[k]) props[k] = row[k];
      }
      features.push({ type: 'Feature', geometry: ex.geometry, properties: props });
      continue;
    }
    // New garage — geocode by postcode
    const pc = extractPostcode(row['Garage address'] || row['Company address']);
    if (!pc) { console.warn(`  Skipping ${row['Garage name']}: no postcode`); continue; }
    const entry = cache[pc];
    if (!entry || entry._failed) { console.warn(`  Skipping ${row['Garage name']}: geocode failed (${pc})`); continue; }
    const props = {};
    for (const k of GARAGE_PROPS) props[k] = row[k] ?? '';
    props._geocode_source = 'postcodes.io';
    props._geocode_postcode = pc;
    props._geocode_admin_district = entry.admin_district;
    props._geocode_country = entry.country;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+entry.lon.toFixed(6), +entry.lat.toFixed(6)] },
      properties: props,
    });
  }

  features.sort((a, b) => {
    const ac = String(a.properties['TfL garage code'] || '').toUpperCase();
    const bc = String(b.properties['TfL garage code'] || '').toUpperCase();
    return ac.localeCompare(bc);
  });

  const payload = {
    type: 'FeatureCollection',
    metadata: {
      source: 'http://www.londonbusroutes.net/garages.htm',
      csv_url: GARAGES_CSV_URL,
      generated_at_utc: new Date().toISOString(),
      licence: 'Open Government Licence v3.0',
    },
    features,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');
  console.log(`Wrote ${features.length} garage features to ${OUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
