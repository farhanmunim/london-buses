/**
 * fetch-route-mps.js -- Per-route Minimum Performance Standards (MPS)
 *
 * TfL publishes a small PDF per route at:
 *   https://bus.data.tfl.gov.uk/boroughreports/routes/performance-route-{ID}.pdf
 *
 * Each PDF contains, for the trailing 13 4-week periods:
 *   - Current year actuals  (EWT for high-frequency / % On-Time for low-frequency)
 *   - Previous year actuals (same metric, prior FY for comparison)
 *   - Minimum Standard      (the contractual MPS the route is graded against)
 *   - Mileage Operated %    (current actual)
 *   - Mileage Minimum Standard
 *
 * MPS is contract-defined and only changes when a new tender is awarded,
 * so this is a sticky cache: a route already classified is not re-fetched
 * unless its TTL expires OR the PDF's Last-Modified header has moved.
 *
 * Output: data/source/route-mps.json (force-committed across runs)
 *   {
 *     generatedAt, totalRoutes, fetchedThisRun, errored,
 *     mpsTtlDays,
 *     routes: {
 *       [routeId]: {
 *         service_class:        'high-frequency' | 'low-frequency',
 *         ewt_mps_minutes:      number | null,    // high-frequency only
 *         otp_mps_percent:      number | null,    // low-frequency only
 *         mileage_mps_percent:  number | null,    // both
 *         pdf_modified_at:      ISO,
 *         lastCheckedAt:        ISO,
 *         status:               200 | 404 | <error>
 *       }
 *     }
 *   }
 *
 * Run: npm run fetch-route-mps
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { sanitizeRecord } from './_lib/sanitize.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc =
  pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const ROUTES_IDX = path.join(ROOT, 'data', 'routes', 'index.json');
const OUT_PATH   = path.join(ROOT, 'data', 'source', 'route-mps.json');

const PDF_URL    = (id) => `https://bus.data.tfl.gov.uk/boroughreports/routes/performance-route-${id}.pdf`;
const USER_AGENT = 'london-buses-map/2.7 (route-mps)';

// ── Config ──────────────────────────────────────────────────────────────────
const MPS_TTL_DAYS    = 28;     // re-check every TfL period (~4 weeks). MPS itself only moves at tender renewal but we want fresh actuals.
const RPS             = 4;      // gentle on TfL's static-PDF host
const TIMEOUT_MS      = 30_000;
const MAX_PER_RUN     = 1000;   // hard cap per run; whole London fleet ~700 routes so a cold start fits comfortably
const FLUSH_EVERY     = 50;
const RETRIES         = 3;

// ── HTTP ────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function headLastModified(url) {
  try {
    const r = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) return { status: r.status, lastModified: null };
    const lm = r.headers.get('last-modified');
    return { status: 200, lastModified: lm ? new Date(lm).toISOString() : null };
  } catch {
    return { status: 0, lastModified: null };
  }
}

async function fetchPdfBuffer(url) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
      if (r.status === 404) return { status: 404 };
      if (!r.ok) {
        if (attempt === RETRIES) return { status: r.status };
        await new Promise(s => setTimeout(s, 500 * 2 ** (attempt - 1)));
        continue;
      }
      const lm = r.headers.get('last-modified');
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: 200, buffer: buf, lastModified: lm ? new Date(lm).toISOString() : null };
    } catch (err) {
      if (attempt === RETRIES) return { status: 0, error: err.message };
      await new Promise(s => setTimeout(s, 500 * 2 ** (attempt - 1)));
    }
  }
}

// ── PDF → rows by y-coord ──────────────────────────────────────────────────
async function extractRows(buffer) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const it of content.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x, s });
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      rows.push(byY.get(y).sort((a, b) => a.x - b.x).map(c => c.s));
    }
  }
  return rows;
}

// ── MPS parser ─────────────────────────────────────────────────────────────
// The PDF has two clearly delineated sections, each containing a row labelled
// "Minimum Standard" followed by 13 identical numeric values (the period
// breakdown — same value across every period for a given contract).
//
//   Reliability Performance
//     Header line: "High Frequency - EWT (mins)" or "Low Frequency - % On Time"
//     ...
//     Minimum Standard | 0.70 | 0.70 | ... (13×)
//
//   Mileage Performance
//     ...
//     Minimum Standard | 98.00 | 98.00 | ... (13×)
//
// We walk the rows in order; a "Minimum Standard" row's first numeric value
// is the MPS for the section we're currently in.
function parseMps(rows) {
  let serviceClass = null;
  let section = null;          // 'reliability' | 'mileage'
  const out = { service_class: null, ewt_mps_minutes: null, otp_mps_percent: null, mileage_mps_percent: null };

  for (const cells of rows) {
    if (!cells.length) continue;
    const flat = cells.join(' ').toLowerCase();

    // Section detection
    if (/reliability\s+performance/i.test(flat)) { section = 'reliability'; continue; }
    if (/mileage\s+performance/i.test(flat))     { section = 'mileage';     continue; }

    // Service class detection -- appears once near the top of the reliability section
    if (!serviceClass) {
      if (/high\s*frequency/i.test(flat) && /ewt/i.test(flat)) serviceClass = 'high-frequency';
      else if (/low\s*frequency/i.test(flat) && /on\s*time/i.test(flat)) serviceClass = 'low-frequency';
    }

    // Minimum Standard rows: first cell label, remaining cells are numbers (13 periods).
    // Any cell that is "Minimum Standard" (case-insensitive, exact) marks the row.
    if (cells.some(c => /^minimum\s*standard$/i.test(c))) {
      // Find the first numeric value in the row.
      let val = null;
      for (const c of cells) {
        const n = parseFloat(c);
        if (Number.isFinite(n) && n > 0) { val = n; break; }
      }
      if (val == null) continue;
      if (section === 'reliability') {
        if (serviceClass === 'high-frequency') out.ewt_mps_minutes = val;
        else if (serviceClass === 'low-frequency') out.otp_mps_percent = val;
      } else if (section === 'mileage') {
        out.mileage_mps_percent = val;
      }
    }
  }

  out.service_class = serviceClass;
  return out;
}

// ── Cache I/O ──────────────────────────────────────────────────────────────
function loadCache() {
  if (!fs.existsSync(OUT_PATH)) return { routes: {} };
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    return { routes: j.routes ?? {} };
  } catch (err) {
    console.warn(`Cache unreadable (${err.message}) — starting fresh`);
    return { routes: {} };
  }
}

function flushCache(cache, fetchedThisRun, errored) {
  const output = {
    generatedAt:     new Date().toISOString(),
    mpsTtlDays:      MPS_TTL_DAYS,
    totalRoutes:     Object.keys(cache.routes).length,
    fetchedThisRun,
    errored,
    routes:          cache.routes,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const tmp = OUT_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sanitizeRecord(output)), 'utf8');
  fs.renameSync(tmp, OUT_PATH);
}

function isFresh(cached, cutoffMs) {
  if (!cached?.lastCheckedAt) return false;
  const ts = new Date(cached.lastCheckedAt).getTime();
  return Number.isFinite(ts) && ts >= cutoffMs;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(ROUTES_IDX)) {
    console.error(`Error: ${ROUTES_IDX} not found. Run fetch-data first.`);
    process.exit(1);
  }
  const idx = JSON.parse(fs.readFileSync(ROUTES_IDX, 'utf8'));
  const allRoutes = (idx.routes ?? []).map(s => String(s).toUpperCase());
  console.log(`Index: ${allRoutes.length} routes`);

  const cache  = loadCache();
  const cutoff = Date.now() - MPS_TTL_DAYS * 86_400_000;

  // Order: never-fetched first, then oldest-checked, capped by MAX_PER_RUN.
  const stale = allRoutes.filter(id => !isFresh(cache.routes[id], cutoff));
  stale.sort((a, b) => {
    const ta = cache.routes[a]?.lastCheckedAt ?? '';
    const tb = cache.routes[b]?.lastCheckedAt ?? '';
    return ta.localeCompare(tb);
  });
  const toFetch = stale.slice(0, MAX_PER_RUN);
  console.log(`Stale: ${stale.length} routes; processing ${toFetch.length} this run (cap ${MAX_PER_RUN}, TTL ${MPS_TTL_DAYS}d)`);

  if (!toFetch.length) {
    console.log('Cache fully warm — nothing to fetch.');
    flushCache(cache, 0, 0);
    return;
  }

  let fetched = 0, errored = 0, skippedHead = 0;

  // SIGTERM/SIGINT safe: flush before exit so a CI timeout never loses progress.
  const onSignal = () => { try { flushCache(cache, fetched, errored); } catch {} process.exit(130); };
  process.once('SIGINT',  onSignal);
  process.once('SIGTERM', onSignal);

  const minIntervalMs = Math.ceil(1000 / RPS);
  let nextSlot = Date.now();

  for (const id of toFetch) {
    const wait = nextSlot - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    nextSlot = Date.now() + minIntervalMs;

    const url = PDF_URL(id);
    const prev = cache.routes[id] ?? {};

    // HEAD short-circuit — if the PDF hasn't moved since we last parsed it,
    // skip the body. Keeps the fetcher cheap during steady-state runs.
    if (prev.pdf_modified_at) {
      const head = await headLastModified(url);
      if (head.status === 200 && head.lastModified === prev.pdf_modified_at) {
        cache.routes[id] = { ...prev, lastCheckedAt: new Date().toISOString(), status: 200 };
        skippedHead++;
        continue;
      }
      if (head.status === 404) {
        cache.routes[id] = { ...prev, lastCheckedAt: new Date().toISOString(), status: 404 };
        continue;
      }
    }

    const dl = await fetchPdfBuffer(url);
    const now = new Date().toISOString();
    if (dl.status === 200 && dl.buffer) {
      try {
        const rows = await extractRows(dl.buffer);
        const parsed = parseMps(rows);
        cache.routes[id] = {
          ...parsed,
          pdf_modified_at: dl.lastModified,
          lastCheckedAt:   now,
          status:          200,
        };
        fetched++;
      } catch (err) {
        cache.routes[id] = { ...prev, lastCheckedAt: now, status: 'parse_error', error: err.message };
        errored++;
      }
    } else if (dl.status === 404) {
      // Some routes (e.g. school routes 600-799) genuinely have no MPS PDF
      // published. Cache the 404 so we don't keep hammering.
      cache.routes[id] = { ...prev, lastCheckedAt: now, status: 404 };
    } else {
      cache.routes[id] = { ...prev, lastCheckedAt: now, status: dl.status, error: dl.error ?? null };
      errored++;
    }

    if ((fetched + errored + skippedHead) % FLUSH_EVERY === 0) {
      flushCache(cache, fetched, errored);
      console.log(`  ${fetched + errored + skippedHead}/${toFetch.length}  ok=${fetched} skip=${skippedHead} err=${errored} (cache flushed)`);
    }
  }

  flushCache(cache, fetched, errored);
  console.log(`Done: ok=${fetched} skip=${skippedHead} err=${errored}  total cached=${Object.keys(cache.routes).length}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
