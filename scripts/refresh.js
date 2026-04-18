/**
 * refresh.js — Full data refresh orchestrator
 *
 * Pipeline order:
 *   1. fetch-data.js                — geometry ZIP → per-route GeoJSON
 *   2. fetch-route-destinations.js  — TfL API → data/route_destinations.json (ref shape)
 *   3. fetch-stops.js               — TfL API → data/stops.geojson
 *   4. fetch-garages.js             — londonbusroutes.net CSV + postcodes.io → data/garages.geojson
 *   5. fetch-frequencies.js         — TfL timetables → data/frequencies.json
 *   6. fetch-route-details.js       — join garages + details.htm → data/source/route_details.json
 *   7. build-classifications.js     — build data/route_classifications.json
 *   8. build-overview.js            — simplified network overview + archive
 *   9. build-garage-locations.js    — geocode garages (legacy garage-locations.json for frontend)
 *  10. build-route-summary.js       — data/route_summary.csv
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { label: 'Step 1/10 — Route geometry',                script: 'fetch-data.js' },
  { label: 'Step 2/10 — Route destinations (TfL API)',  script: 'fetch-route-destinations.js' },
  { label: 'Step 3/10 — Bus stops (TfL API)',           script: 'fetch-stops.js' },
  { label: 'Step 4/10 — Garages CSV + geocode',         script: 'fetch-garages.js' },
  { label: 'Step 5/10 — Frequencies from timetables',   script: 'fetch-frequencies.js' },
  { label: 'Step 6/10 — Route details (vehicle/op/garage)', script: 'fetch-route-details.js' },
  { label: 'Step 7/10 — Build classifications',         script: 'build-classifications.js' },
  { label: 'Step 8/10 — Build overview + snapshot',     script: 'build-overview.js' },
  { label: 'Step 9/10 — Legacy garage-locations.json',  script: 'build-garage-locations.js' },
  { label: 'Step 10/10 — Route summary CSV',            script: 'build-route-summary.js' },
];

const started = Date.now();
console.log('=== London Buses — Full Data Refresh ===\n');

for (const { label, script } of STEPS) {
  console.log(`\n──────────────────────────────────────`);
  console.log(label);
  console.log(`──────────────────────────────────────`);
  const stepStart = Date.now();
  execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  console.log(`  Done in ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
}

const totalSec = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n=== Refresh complete in ${totalSec}s ===`);
