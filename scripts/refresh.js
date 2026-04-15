/**
 * refresh.js — Full data refresh orchestrator
 *
 * Runs all three build steps in the correct order:
 *   1. fetch-data.js             — download geometry, stops, destinations
 *   2. build-classifications.js  — derive route types and length bands
 *   3. build-overview.js         — build the simplified network overview + snapshot archive
 *
 * Usage:
 *   npm run refresh           (recommended)
 *   node scripts/refresh.js
 *
 * Each step is run as a child process so errors surface immediately.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { label: 'Step 1/5 — Fetch route geometry, stops & destinations', script: 'fetch-data.js' },
  { label: 'Step 2/5 — Fetch supplementary route details',          script: 'fetch-route-details.js' },
  { label: 'Step 3/5 — Build route classifications',                script: 'build-classifications.js' },
  { label: 'Step 4/5 — Build overview layer & snapshot archive',    script: 'build-overview.js' },
  { label: 'Step 5/5 — Build/refresh garage locations (geocode)',   script: 'build-garage-locations.js' },
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
