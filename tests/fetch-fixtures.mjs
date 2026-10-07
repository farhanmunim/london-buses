/* Downloads the pinned browser libraries the test suites serve from
   tests/fixtures/ in place of the CDN, so every suite runs offline and
   never depends on unpkg being up. The versions and integrity hashes are
   the same ones index.html / v3.html load, so a test exercises exactly the
   code that ships. The fixtures are gitignored (tests/.gitignore): run this
   once after cloning —  node tests/fetch-fixtures.mjs  (or npm run test:fixtures). */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const FILES = [
  ['leaflet.css',            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',                               'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='],
  ['leaflet.js',             'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',                                'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
  ['leaflet-heat.js',        'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',                      'sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0'],
  ['maplibre-gl.css',        'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',                      'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK'],
  ['maplibre-gl.js',         'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',                       'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp'],
  ['leaflet-maplibre-gl.js', 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js',   'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS'],
];
const force = process.argv.includes('--force');
mkdirSync(DIR, { recursive: true });
let bad = 0;
for (const [name, url, sri] of FILES) {
  const dest = join(DIR, name);
  if (existsSync(dest) && !force) { console.log(`  ✓ ${name} (present)`); continue; }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) { console.error(`  ✗ ${name}: HTTP ${res.status} from ${url}`); bad++; continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const [algo, want] = sri.split('-', 2);
  const got = createHash(algo).update(buf).digest('base64');
  if (got !== want) { console.error(`  ✗ ${name}: integrity mismatch (expected ${sri}, got ${algo}-${got})`); bad++; continue; }
  writeFileSync(dest, buf);
  console.log(`  ✓ ${name} (${(buf.length / 1024).toFixed(0)} KB, ${algo} ok)`);
}
if (bad) { console.error(`\n${bad} fixture(s) failed — the browser suites need all six.`); process.exit(1); }
console.log('\nFixtures ready in tests/fixtures/. Run a suite with: node tests/verify-<name>.mjs');
