/**
 * fetch-route-vehicles.js — Per-route vehicle observations from TfL arrivals
 *
 * For every bus line, calls TfL `/Line/<id>/Arrivals` and collects the unique
 * `vehicleId` values from the prediction list. The vehicleId in TfL's Unified
 * API is the bus registration (e.g. `LK20FNZ`), so this gives us the set of
 * registrations actually working a route at the moment of the snapshot.
 *
 * Designed to run weekly at peak (Mondays 09:00 UTC = 09:00 GMT / 10:00 BST)
 * so the snapshot catches a representative active fleet. Each refresh appends
 * newly-seen registrations to the per-route set; entries older than
 * `OBSERVATION_TTL_DAYS` are pruned. Steady-state coverage is well above 90%
 * after two or three Mondays.
 *
 * Output: data/source/route-vehicles.json
 *   {
 *     generatedAt, observationTtlDays,
 *     routes: {
 *       [routeId]: [
 *         { reg: "LK20FNZ", lastSeenAt: "2026-04-28T09:00:00Z" },
 *         …
 *       ]
 *     }
 *   }
 *
 * Run: npm run fetch-route-vehicles
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'source', 'route-vehicles.json');
const BASE_URL  = 'https://api.tfl.gov.uk';

const OBSERVATION_TTL_DAYS = 56;   // ~8 weeks of Monday samples accumulate
const CONC                 = 4;
const REQS_PER_MIN         = 300;
const TIMEOUT_MS           = 30_000;

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

function apiUrl(ep) {
  return `${BASE_URL}${ep}${API_KEY ? `${ep.includes('?') ? '&' : '?'}app_key=${API_KEY}` : ''}`;
}

async function fetchJson(url, retries = 4) {
  for (let i = 1; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      clearTimeout(timer);
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, i * 800));
    }
  }
}

function loadExisting() {
  if (!fs.existsSync(OUT_PATH)) return { routes: {} };
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    return { routes: j.routes ?? {} };
  } catch {
    return { routes: {} };
  }
}

async function main() {
  console.log('Fetching bus lines...');
  const lines = await fetchJson(apiUrl('/Line/Mode/bus'));
  const ids = [...new Set((lines ?? []).map(l => String(l.id).toUpperCase()))].sort();
  console.log(`  ${ids.length} routes`);

  const existing = loadExisting();
  const cutoff = Date.now() - OBSERVATION_TTL_DAYS * 86_400_000;

  const observations = {};   // { routeId: Map(reg → lastSeenAt) }
  const sampledAt = new Date().toISOString();

  // Seed with previously-observed regs that haven't expired
  for (const [rid, list] of Object.entries(existing.routes)) {
    const m = new Map();
    for (const entry of (list ?? [])) {
      const reg = typeof entry === 'string' ? entry : entry?.reg;
      const seen = typeof entry === 'object' ? entry?.lastSeenAt : null;
      if (!reg) continue;
      const seenMs = seen ? new Date(seen).getTime() : 0;
      if (seenMs >= cutoff) m.set(reg.toUpperCase(), seen);
    }
    if (m.size) observations[rid] = m;
  }

  const minInterval = Math.ceil(60_000 / REQS_PER_MIN);
  let nextSlot = Date.now();
  let idx = 0, done = 0, withObs = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= ids.length) break;

      const wait = nextSlot - Date.now();
      nextSlot = Math.max(Date.now(), nextSlot) + minInterval;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const id = ids[i];
      const arr = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/Arrivals`));
      if (Array.isArray(arr)) {
        const regs = new Set();
        for (const p of arr) {
          // TfL exposes the registration as `vehicleId`. Filter to plate-shaped
          // strings — buses use UK reg plates, so we drop any blank, numeric
          // train ids, or unexpected formats.
          const v = String(p?.vehicleId ?? '').toUpperCase().replace(/\s+/g, '');
          if (/^[A-Z]{1,3}\d{1,3}[A-Z]{0,3}$|^[A-Z]{2}\d{2}[A-Z]{3}$/.test(v)) regs.add(v);
        }
        if (regs.size) {
          if (!observations[id]) observations[id] = new Map();
          for (const r of regs) observations[id].set(r, sampledAt);
          withObs++;
        }
      }

      done++;
      if (done % 50 === 0) console.log(`  ${done}/${ids.length}  withObs=${withObs}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // Serialise back as { reg, lastSeenAt }
  const routesOut = {};
  for (const id of Object.keys(observations).sort()) {
    routesOut[id] = [...observations[id].entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reg, lastSeenAt]) => ({ reg, lastSeenAt }));
  }

  const output = {
    generatedAt:        new Date().toISOString(),
    observationTtlDays: OBSERVATION_TTL_DAYS,
    routeCount:         Object.keys(routesOut).length,
    routes:             routesOut,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`Wrote vehicle observations for ${output.routeCount} routes to ${OUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
