/**
 * build-garage-locations.js
 *
 * Scrapes garage code / name / operator / address from
 * londonbusroutes.net/garages.htm and geocodes each address via OpenStreetMap
 * Nominatim. Output: data/garage-locations.json.
 *
 * Results are cached: on subsequent runs, only garages with a new or changed
 * address are re-geocoded. This makes the weekly refresh cheap (usually zero
 * lookups) and keeps us well within Nominatim's usage policy.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = path.join(__dirname, '..', 'data', 'garage-locations.json');

const USER_AGENT      = 'london-buses-map/2.0 (https://github.com/farhanmunim/london-buses)';
const NOMINATIM_DELAY = 200;   // ms between requests — Photon has no strict limit; tiny courtesy delay
const BACKOFF_ON_429  = 60_000; // ms — Nominatim abuse-throttle cooldown (fallback only)

// London bounding box (rough) — clamp geocoder results to reject out-of-region hits.
const LONDON_BBOX = { minLat: 51.28, maxLat: 51.72, minLon: -0.55, maxLon: 0.35 };

// ── HTML helpers (mirror fetch-route-details.js) ──────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
}

// ── Step 1: Parse garages page → { code, name, operator, address } ────────────

async function fetchGarages() {
  console.log('Fetching garage/operator list...');
  const html = await fetchText('http://www.londonbusroutes.net/garages.htm');
  console.log(`  Downloaded ${(html.length / 1024).toFixed(0)} KB`);

  const garages = [];
  let currentOp = null;

  const trRe = /<TR[^>]*>([\s\S]*?)<\/TR>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const row = m[1];

    if (/colspan=['"']?4/i.test(row) && /<TH/i.test(row)) {
      const thM = row.match(/<TH[^>]*>([\s\S]*?)<\/TH>/i);
      if (thM) {
        const name = stripHtml(thM[1]).replace(/\s*\d[\d.%()\s]*$/, '').trim();
        if (name && !/^\d/.test(name)) currentOp = name;
      }
      continue;
    }

    const codeM = row.match(/<a\s+name=['"']?([A-Z0-9]{1,4})['"']?/i);
    if (!codeM || !currentOp) continue;

    const cells = [];
    const tdRe  = /<T[DH][^>]*>([\s\S]*?)<\/T[DH]>/gi;
    let cm;
    while ((cm = tdRe.exec(row)) !== null) cells.push(stripHtml(cm[1]));

    const code    = codeM[1].toUpperCase();
    const name    = cells[1]?.trim() || '';
    const address = cells[2]?.trim() || '';
    if (code && name) garages.push({ code, name, operator: currentOp, address });
  }

  console.log(`  Parsed ${garages.length} garages (${garages.filter(g => g.address).length} with address)`);
  return garages;
}

// ── Step 2: Nominatim geocoder ────────────────────────────────────────────────

/**
 * Geocoder. Photon (https://photon.komoot.io) is the primary — it's OSM-backed
 * and far more permissive than Nominatim. Nominatim is the fallback for edge
 * cases where Photon returns nothing.
 */
async function geocode(query) {
  // Bias results around central London so near-capital hits outrank similarly
  // named places elsewhere in the UK.
  const photonUrl = `https://photon.komoot.io/api/?limit=1&lat=51.5&lon=-0.1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(photonUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const json = await res.json();
      const f = json?.features?.[0];
      if (f?.geometry?.coordinates) {
        const [lon, lat] = f.geometry.coordinates;
        return { lat, lon };
      }
    }
  } catch (err) {
    console.warn(`    photon error: ${err.message}`);
  }

  // Fallback: Nominatim (rate-limited)
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(nomUrl, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB' } });
    if (res.status === 429) {
      console.warn(`    nominatim 429 — cooling ${BACKOFF_ON_429 / 1000}s`);
      await sleep(BACKOFF_ON_429);
      continue;
    }
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const { lat, lon } = json[0];
    return { lat: parseFloat(lat), lon: parseFloat(lon) };
  }
  return null;
}

function inLondon({ lat, lon }) {
  return lat >= LONDON_BBOX.minLat && lat <= LONDON_BBOX.maxLat
      && lon >= LONDON_BBOX.minLon && lon <= LONDON_BBOX.maxLon;
}

/**
 * Try progressively looser queries until one lands inside London.
 * Start with the full address, then trim the leading house number,
 * then fall back to "<name> bus garage, London".
 */
async function geocodeGarage(garage) {
  const attempts = [];
  if (garage.address) {
    attempts.push(garage.address);
    // Drop leading "123 " house number — often improves OSM matches for depots
    attempts.push(garage.address.replace(/^\d+\s+/, ''));
  }
  attempts.push(`${garage.name} bus garage, London`);

  for (const q of attempts) {
    try {
      const r = await geocode(q);
      if (r && inLondon(r)) return { ...r, resolvedFrom: q };
    } catch (err) {
      console.warn(`    geocode error for "${q}": ${err.message}`);
    }
    await sleep(NOMINATIM_DELAY);
  }
  return null;
}

// ── Step 3: Merge with cache + write ──────────────────────────────────────────

function loadCache() {
  if (!fs.existsSync(OUT_PATH)) return { garages: {} };
  try { return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); }
  catch { return { garages: {} }; }
}

async function main() {
  const started = Date.now();
  console.log('=== Building garage locations ===\n');

  const scraped = await fetchGarages();
  const cache   = loadCache();
  const out     = { generatedAt: new Date().toISOString(), count: 0, garages: {} };

  let reused = 0, geocoded = 0, failed = 0, skipped = 0;

  for (const g of scraped) {
    const cached = cache.garages?.[g.code];

    // Reuse cached entry if the scraped address hasn't changed
    if (cached && cached.address === g.address && cached.lat != null && cached.lon != null) {
      out.garages[g.code] = { ...cached, name: g.name, operator: g.operator };
      reused++;
      continue;
    }

    if (!g.address) {
      console.log(`  ${g.code} ${g.name} — no address, skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${g.code} ${g.name} — geocoding... `);
    const r = await geocodeGarage(g);
    if (r) {
      out.garages[g.code] = {
        code: g.code, name: g.name, operator: g.operator, address: g.address,
        lat: r.lat, lon: r.lon,
      };
      geocoded++;
      console.log(`OK (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)})`);
    } else {
      out.garages[g.code] = { code: g.code, name: g.name, operator: g.operator, address: g.address, lat: null, lon: null };
      failed++;
      console.log('FAILED');
    }
  }

  out.count = Object.values(out.garages).filter(g => g.lat != null).length;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`  ${out.count}/${scraped.length} located (reused ${reused}, new ${geocoded}, failed ${failed}, skipped ${skipped}) in ${sec}s`);
}

main().catch(err => { console.error(err); process.exit(1); });
