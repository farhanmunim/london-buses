/**
 * build-garage-locations.js
 *
 * Derives the legacy `data/garage-locations.json` consumed by the frontend
 * (api.js → fetchGarageLocations) from the authoritative `data/garages.geojson`
 * produced by fetch-garages.js (Step 4 — postcodes.io geocoded).
 *
 * Why this rewrite: the previous implementation scraped garages.htm and
 * geocoded via Photon with a London-only bounding-box filter. Out-of-London
 * garages (Grays, Slough, Crawley, Hatfield) failed that filter and silently
 * fell back to central London, mis-plotting four pins. postcodes.io handles
 * every UK postcode correctly, so we just project its output into the legacy
 * shape instead of re-geocoding.
 *
 * Legacy shape preserved exactly so api.js and the map don't need to change:
 *   { generatedAt, count, garages: { <code>: { code, name, operator, address, lat, lon } } }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const IN_PATH   = path.join(DATA_DIR, 'garages.geojson');
const OUT_PATH  = path.join(DATA_DIR, 'garage-locations.json');

if (!fs.existsSync(IN_PATH)) {
  console.error(`Error: ${IN_PATH} not found. Run fetch-garages first.`);
  process.exit(1);
}

const fc = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
const garages = {};
let skipped = 0;

for (const f of fc.features ?? []) {
  const p = f.properties ?? {};
  // Key by TfL code (what route_classifications uses) with fallback to LBR code.
  // e.g. Uxbridge Industrial Estate has LBR=UE, TfL=UX — classifications say UX.
  const code = p['TfL garage code'] || p['LBR garage code'];
  if (!code) { skipped++; continue; }
  if (garages[code]) continue; // dedupe rows that appear twice in the CSV

  // Skip garages with no current TfL routes — this is a London bus map, and
  // the CSV includes out-of-scope operators (Sullivan, Diamond, Falcon, ...)
  // whose depots would otherwise render as empty pins.
  const hasRoutes =
       (p['TfL main network routes']    || '').trim()
    || (p['TfL night routes']           || '').trim()
    || (p['TfL school/mobility routes'] || '').trim();
  if (!hasRoutes) { skipped++; continue; }

  const coords = f.geometry?.coordinates;
  const [lon, lat] = Array.isArray(coords) ? coords : [null, null];

  const pvrNum = parseInt(p['PVR'], 10);

  garages[code] = {
    code,
    name:     p['Garage name'] || '',
    operator: p['Group name']  || '',
    address:  p['Garage address'] || '',
    lat:      Number.isFinite(lat) ? lat : null,
    lon:      Number.isFinite(lon) ? lon : null,
    pvr:      Number.isFinite(pvrNum) ? pvrNum : null,
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  count:       Object.keys(garages).length,
  garages,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`Wrote ${output.count} garages → ${path.relative(process.cwd(), OUT_PATH)}`);
if (skipped) console.log(`  (skipped ${skipped} features without a garage code)`);

const missingCoords = Object.values(garages).filter(g => g.lat == null).length;
if (missingCoords) console.log(`  (${missingCoords} garages have no coordinates — will be hidden on map)`);
