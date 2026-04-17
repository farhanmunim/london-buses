/**
 * build-route-summary.js — Consolidated per-route CSV
 *
 * Joins:
 *   data/garages.geojson         — operator / garage / vehicle / PVR (via route_details)
 *   data/route_classifications.json — route_type / deck / propulsion
 *   data/route_destinations.json — outbound/inbound destination + qualifier + full
 *   data/frequencies.json        — headways per band
 *   data/routes/<id>.geojson     — length_km
 *
 * Output: data/route_summary.csv (columns match RouteMapster reference).
 * Run: npm run build-route-summary
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '..', 'data');
const OUT_PATH  = path.join(DATA_DIR, 'route_summary.csv');

const DEG2RAD = Math.PI / 180;
function haversineKm(a, b) {
  const dLat = (b[1] - a[1]) * DEG2RAD, dLon = (b[0] - a[0]) * DEG2RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG2RAD) * Math.cos(b[1] * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}
function routeLengthKm(geojson) {
  let total = 0;
  for (const f of (geojson.features ?? [])) {
    if (String(f.properties?.direction) !== '1') continue;
    const { type, coordinates } = f.geometry;
    const segs = type === 'MultiLineString' ? coordinates : [coordinates];
    for (const seg of segs) for (let i = 0; i < seg.length - 1; i++) total += haversineKm(seg[i], seg[i + 1]);
  }
  return total;
}

function load(p, dflt) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const classFile = load(path.join(DATA_DIR, 'route_classifications.json'), { routes: {} });
  const destFile  = load(path.join(DATA_DIR, 'route_destinations.json'),    { routes: {} });
  const freqs     = load(path.join(DATA_DIR, 'frequencies.json'), {});
  const routesDir = path.join(DATA_DIR, 'routes');
  const indexFile = load(path.join(routesDir, 'index.json'), { routes: [] });

  const routeIds = indexFile.routes ?? Object.keys(classFile.routes ?? {});
  const cols = [
    'route','route_type','garage_code','garage_name','operator','vehicle',
    'destination_outbound','destination_inbound',
    'destination_outbound_qualifier','destination_inbound_qualifier',
    'destination_outbound_full','destination_inbound_full',
    'frequency_peak_am','frequency_peak_pm','frequency_offpeak','frequency_overnight','frequency_weekend',
    'length_km','length_miles',
  ];
  const rows = [cols.join(',')];

  for (const id of routeIds) {
    const cls = classFile.routes?.[id] ?? {};
    const dst = destFile.routes?.[id] ?? {};
    const f = freqs[id] ?? {};
    let lengthKm = null;
    try {
      const g = JSON.parse(fs.readFileSync(path.join(routesDir, `${id}.geojson`), 'utf8'));
      lengthKm = +routeLengthKm(g).toFixed(3);
    } catch {}
    const r = {
      route: id,
      route_type: cls.isPrefix ? 'prefix' : (cls.type ?? ''),
      garage_code: cls.garageCode ?? '',
      garage_name: cls.garageName ?? '',
      operator:    cls.operator ?? '',
      vehicle:     cls.vehicleType ?? '',
      destination_outbound: dst.outbound?.destination ?? '',
      destination_inbound:  dst.inbound?.destination  ?? '',
      destination_outbound_qualifier: dst.outbound?.qualifier ?? '',
      destination_inbound_qualifier:  dst.inbound?.qualifier  ?? '',
      destination_outbound_full: dst.outbound?.full ?? '',
      destination_inbound_full:  dst.inbound?.full  ?? '',
      frequency_peak_am:  f.peak_am ?? '',
      frequency_peak_pm:  f.peak_pm ?? '',
      frequency_offpeak:  f.offpeak ?? '',
      frequency_overnight: f.overnight ?? '',
      frequency_weekend:  f.weekend ?? '',
      length_km:   lengthKm ?? '',
      length_miles: lengthKm != null ? +(lengthKm * 0.621371).toFixed(2) : '',
    };
    rows.push(cols.map(c => csvEscape(r[c])).join(','));
  }
  fs.writeFileSync(OUT_PATH, rows.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${rows.length - 1} routes to ${OUT_PATH}`);
}

main();
