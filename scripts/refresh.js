/**
 * refresh.js — Full data refresh orchestrator
 *
 * Pipeline order:
 *   1. fetch-data.js                — geometry ZIP → per-route GeoJSON
 *   2. fetch-route-destinations.js  — TfL API → data/route_destinations.json
 *   3. fetch-route-stops.js         — TfL API → data/route_stops.json + data/stops.json
 *   4. fetch-garages.js             — londonbusroutes.net CSV + postcodes.io → data/garages.geojson
 *   5. fetch-frequencies.js         — TfL timetables → data/frequencies.json
 *   6. fetch-route-details.js       — garages + details.htm → data/source/route_details.json
 *   7. build-classifications.js     — data/route_classifications.json (master per-route record)
 *   8. build-overview.js            — simplified network overview layer
 *   9. build-garage-locations.js    — geocode garages → data/garage-locations.json (frontend)
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { label: 'Step 1/9 — Route geometry',                     script: 'fetch-data.js' },
  { label: 'Step 2/9 — Route destinations (TfL API)',       script: 'fetch-route-destinations.js' },
  { label: 'Step 3/9 — Route stops (TfL API)',              script: 'fetch-route-stops.js' },
  { label: 'Step 4/9 — Garages CSV + geocode',              script: 'fetch-garages.js' },
  { label: 'Step 5/9 — Frequencies from timetables',        script: 'fetch-frequencies.js' },
  { label: 'Step 6/9 — Route details (vehicle/op/garage)',  script: 'fetch-route-details.js' },
  { label: 'Step 7/9 — Build classifications',              script: 'build-classifications.js' },
  { label: 'Step 8/9 — Build overview + snapshot',          script: 'build-overview.js' },
  { label: 'Step 9/9 — Garage locations (frontend JSON)',   script: 'build-garage-locations.js' },
];

// Fetch steps are allowed to fail without aborting the whole pipeline — the
// downstream builders already merge last-known-good data, so one flaky scrape
// shouldn't wipe a week of downstream work. Build steps still hard-fail
// because they're pure transformations and should never crash.
const SOFT_FAIL = new Set([
  'fetch-data.js',
  'fetch-route-destinations.js',
  'fetch-route-stops.js',
  'fetch-garages.js',
  'fetch-frequencies.js',
  'fetch-route-details.js',
  'build-garage-locations.js',
]);

const started = Date.now();
console.log('=== London Buses — Full Data Refresh ===\n');

const failures = [];
for (const { label, script } of STEPS) {
  console.log(`\n──────────────────────────────────────`);
  console.log(label);
  console.log(`──────────────────────────────────────`);
  const stepStart = Date.now();
  try {
    execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
    console.log(`  Done in ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    if (SOFT_FAIL.has(script)) {
      failures.push(script);
      console.warn(`  ⚠ ${script} failed — continuing with last-known-good data.`);
    } else {
      throw err;
    }
  }
}

const totalSec = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n=== Refresh complete in ${totalSec}s ===`);
if (failures.length) console.log(`Soft failures: ${failures.join(', ')}`);
