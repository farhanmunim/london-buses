/**
 * fetch-data.js — Route data refresh
 *
 * Downloads the latest route geometry ZIP, converts XML to per-route GeoJSON,
 * then fetches stops and destinations from the public bus API.
 *
 * Output (written to data/):
 *   routes/<id>.geojson        – LineString/MultiLineString per direction
 *   stops.geojson              – all bus stops as GeoJSON FeatureCollection
 *   route_destinations.json    – inbound/outbound names per route
 *
 * Usage:
 *   npm run fetch-data
 *
 * Requires Node 18+. Set BUS_API_KEY in a .env file (see .env.example).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

// Load .env file if present (simple key=value parser, no extra dependency needed)
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* .env is optional */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ROUTES_DIR = path.join(DATA_DIR, 'routes');

const BUS_API  = 'https://api.tfl.gov.uk';
const S3_BASE  = 'https://s3-eu-west-1.amazonaws.com/bus.data.tfl.gov.uk';
const S3_PUBLIC = 'https://bus.data.tfl.gov.uk';

// API key — set BUS_API_KEY in .env (local) or GitHub Actions secrets (CI)
const API_KEY = process.env.BUS_API_KEY ?? '';
if (!API_KEY) console.warn('Warning: BUS_API_KEY not set — API calls may be rate-limited');

const ROUTE_XML_RE = /Route_Geometry_([A-Za-z0-9]+)_(\d{8})\.xml$/i;
const SIMPLIFY_TOLERANCE = 0.00005; // Douglas-Peucker tolerance in degrees
const COORD_PRECISION = 6;

// --- Utilities ---------------------------------------------------------------

function apiUrl(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${BUS_API}${endpoint}${API_KEY ? `${sep}app_key=${API_KEY}` : ''}`;
}

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

/**
 * Run `fn` over `items` with bounded concurrency and optional rate limiting.
 * @param {number} ratePerMin  Max requests per minute (0 = unlimited)
 */
async function batchRun(items, fn, concurrency = 5, ratePerMin = 0) {
  const minIntervalMs = ratePerMin > 0 ? Math.ceil(60_000 / ratePerMin) : 0;
  let idx = 0;
  let nextSlot = Date.now(); // earliest time the next request may start

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;

      if (minIntervalMs > 0) {
        const now = Date.now();
        const wait = nextSlot - now;
        // Advance the shared slot atomically (JS is single-threaded between awaits)
        nextSlot = Math.max(now, nextSlot) + minIntervalMs;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }

      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// --- Geometry: Douglas-Peucker simplification --------------------------------

function ptSegDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(points, tol) {
  if (tol <= 0 || points.length <= 2) return points;
  let maxDist = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = ptSegDist(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > tol) {
    const L = simplify(points.slice(0, idx + 1), tol);
    const R = simplify(points.slice(idx), tol);
    return [...L.slice(0, -1), ...R];
  }
  return [points[0], points[points.length - 1]];
}

function roundCoord(v, precision) {
  const r = parseFloat(v.toFixed(precision));
  return r === -0 ? 0 : r;
}

// --- Step 1: Find and download the latest geometry ZIP -----------------------

async function findLatestZipKey() {
  console.log('Listing S3 bucket for latest Route_Geometry ZIP...');
  const url = `${S3_BASE}/?list-type=2&prefix=bus-geometry/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`S3 listing failed: HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser();
  const doc = parser.parse(xml);
  const contents = doc?.ListBucketResult?.Contents;
  const keys = (Array.isArray(contents) ? contents : [contents])
    .map(c => c?.Key)
    .filter(k => typeof k === 'string' && k.endsWith('.zip'));

  const candidates = keys
    .map(k => {
      const m = k.match(/Route_Geometry_(\d{8})\.zip$/i);
      return m ? { date: m[1], key: k } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!candidates.length) throw new Error('No Route_Geometry ZIPs found in bucket');
  const latest = candidates[0];
  console.log(`  Latest ZIP: ${latest.key} (${latest.date})`);
  return latest;
}

async function downloadZip(key) {
  const url = `${S3_PUBLIC}/${key}`;
  console.log(`Downloading ${url}...`);
  const buf = await fetchBuffer(url);
  console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  return buf;
}

// --- Step 2: Parse XML files and write GeoJSON -------------------------------

function parseRouteXml(xmlContent, routeId, dateToken) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let doc;
  try {
    doc = parser.parse(xmlContent);
  } catch {
    return null;
  }

  const nodes = doc?.TransXChange?.Route_Geometry ?? doc?.Route_Geometry;
  const rawNodes = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

  if (!rawNodes.length) return null;

  // Group by direction → run → sorted sequence
  const groups = {};
  for (const node of rawNodes) {
    const seq = parseInt(node['@_aSequence_No'] ?? node.aSequence_No ?? '0', 10);
    const run = String(node['@_aLBSL_Run_No'] ?? node.aLBSL_Run_No ?? '0').trim();
    const direction = String(node.Direction ?? '').trim();
    const lat = parseFloat(node.Location_Latitude);
    const lon = parseFloat(node.Location_Longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    groups[direction] ??= {};
    groups[direction][run] ??= [];
    groups[direction][run].push([seq, lon, lat]);
  }

  const features = [];
  for (const direction of Object.keys(groups).sort()) {
    const segments = [];
    for (const pts of Object.values(groups[direction])) {
      pts.sort((a, b) => a[0] - b[0]);
      const coords = pts.map(([, lon, lat]) => [lon, lat]);
      if (coords.length < 2) continue;
      const simplified = simplify(coords, SIMPLIFY_TOLERANCE);
      const rounded = simplified.map(([lon, lat]) => [
        roundCoord(lon, COORD_PRECISION),
        roundCoord(lat, COORD_PRECISION),
      ]);
      if (rounded.length >= 2) segments.push(rounded);
    }
    if (!segments.length) continue;

    const geometry = segments.length === 1
      ? { type: 'LineString', coordinates: segments[0] }
      : { type: 'MultiLineString', coordinates: segments };

    features.push({
      type: 'Feature',
      properties: { routeId, direction, sourceDate: dateToken },
      geometry,
    });
  }

  if (!features.length) return null;
  return {
    type: 'FeatureCollection',
    metadata: { routeId, sourceDate: dateToken, source: `${S3_PUBLIC}/bus-geometry/` },
    features,
  };
}

function processZip(zipBuffer, dateToken) {
  console.log('\nProcessing ZIP entries...');
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  let written = 0, skipped = 0;

  for (const entry of entries) {
    const m = entry.entryName.match(ROUTE_XML_RE);
    if (!m) continue;

    const rawId = m[1];
    const routeId = rawId.toUpperCase();

    // Skip 700-series (coaching routes, not bus)
    if (/^\d+$/.test(routeId) && +routeId >= 700 && +routeId <= 799) {
      skipped++;
      continue;
    }

    const xmlContent = entry.getData().toString('utf8');
    const geojson = parseRouteXml(xmlContent, routeId, dateToken);
    if (!geojson) { skipped++; continue; }

    writeJson(path.join(ROUTES_DIR, `${routeId}.geojson`), geojson);
    written++;
  }

  console.log(`  Written: ${written} routes, skipped: ${skipped}`);

  // Write index
  const routeIds = fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('.geojson'))
    .map(f => f.replace('.geojson', ''))
    .sort();
  writeJson(path.join(ROUTES_DIR, 'index.json'), { date: dateToken, routes: routeIds });
  console.log(`  Index written (${routeIds.length} routes)`);
}

// --- Step 3: Route destinations ----------------------------------------------

async function fetchDestinations() {
  console.log('\nFetching route destinations...');
  const lines = await fetchJson(apiUrl('/Line/Mode/bus'));
  const routeIds = lines.map(l => l.id.toUpperCase()).sort();
  console.log(`  ${routeIds.length} routes found`);

  const routes = {};
  let done = 0;

  await batchRun(routeIds, async (id) => {
    try {
      const data = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/Route`));
      const entry = { inbound: null, outbound: null, service_types: [] };

      for (const section of (data.routeSections ?? [])) {
        const dir = section.direction?.toLowerCase();
        if (dir === 'inbound' || dir === 'outbound') {
          entry[dir] = {
            destination: section.destinationName ?? null,
            originator: section.originationName ?? null,
          };
        }
      }
      entry.service_types = (data.serviceTypes ?? []).map(s => s.name);
      routes[id] = entry;
    } catch {
      routes[id] = { inbound: null, outbound: null, service_types: [] };
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${routeIds.length}`);
  }, 5, 350); // 350 req/min — safely under TfL's 500 req/min limit with API key

  return { routeIds, routes };
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log('=== London Buses – Data Refresh ===\n');
  fs.mkdirSync(ROUTES_DIR, { recursive: true });

  // Geometry
  const { date: dateToken, key: zipKey } = await findLatestZipKey();
  const zipBuffer = await downloadZip(zipKey);
  processZip(zipBuffer, dateToken);

  // Destinations
  const { routeIds, routes } = await fetchDestinations();
  writeJson(path.join(DATA_DIR, 'route_destinations.json'), {
    generated_at_utc: new Date().toISOString(),
    route_count: routeIds.length,
    routes,
  });
  console.log('\nWrote route_destinations.json');

  // Write a small file recording the geometry ZIP date so CI can detect changes
  writeJson(path.join(DATA_DIR, 'geometry-source.json'), {
    zipDate: dateToken,
    generatedAt: new Date().toISOString(),
  });

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
