/**
 * fetch-route-performance.js -- Per-route QSI & Mileage performance history.
 *
 * Source: TfL publishes one "QSI & Mileage Performance Results" PDF per bus
 * route on the borough-reports bucket, refreshed quarterly:
 *
 *   bus.data.tfl.gov.uk/boroughreports/routes/performance-route-{ID}.pdf
 *
 * The route list comes from data/api/routes.json (ids uppercased). Some
 * routes -- mostly school (6xx) and mobility services -- have no published
 * PDF; those 404 and are recorded in `missingRoutes` rather than failing
 * the run.
 *
 * PDF layout (single page, two chart-tables, Excel-exported):
 *   1. Reliability -- title row "High Frequency - EWT (mins)" for
 *      high-frequency routes, or "Low Frequency - % On Time" for
 *      low-frequency ones. The metric name is stored per route.
 *   2. Mileage -- "Mileage Performance" / "Mileage Operated (%)".
 *   Each table: a header row ["Period","4","5",...,"13","1","2","3"], then
 *   two series rows labelled like "P04 24/25 to P03 25/26" with 13 numeric
 *   cells, then a "Minimum Standard" row. Column labels 4..13 map to
 *   P04..P13 of the FIRST financial year in the series label and 1..3 to
 *   P01..P03 of the SECOND, giving 26 four-weekly periods per metric.
 *
 * Quirks handled:
 *   - Split-row layout: a series label sometimes lands on its own line with
 *     the 13 numbers on the NEXT line (pdfjs y-clustering puts them a pixel
 *     apart). Both same-row and split-row forms are accepted.
 *   - The chart legend repeats the series labels ABOVE the table header --
 *     parsing only starts after the ["Period","4",...] header row so the
 *     legend is never mistaken for data.
 *   - Calendar-aligned variant: a few routes (55, H26, N89) chart whole
 *     financial years instead of the rolling window -- header columns run
 *     1..13 and the series labels read "P01 25/26 to P13 25/26". The column
 *     labels are read from the header row, and a column at/after the
 *     series' start period maps to the first year in the label, a wrapped
 *     column to the second, which covers both variants with one rule.
 *   - The current-year series may carry fewer than 13 values early in the
 *     year; only cells that exist are emitted.
 *   - Minimum Standard can vary across columns when TfL changes the target
 *     mid-year (e.g. route 389). The scalar `*MinStandard` stores the LAST
 *     column's value -- the standard currently in force.
 *
 * Politeness/perf: the bucket is public S3, so no rate limit -- just a
 * concurrency cap of 6 across ~675 PDFs (~100 KB each). Steady-state runs
 * are cheap: each route's `Last-Modified` is persisted in the source file
 * and a HEAD request skips the download + parse when it hasn't moved
 * (TfL republishes quarterly). `--force` bypasses the cache.
 *
 * Output:
 *   data/source/route-performance.json  -- full record incl. cache metadata
 *   data/api/route-performance.json     -- served contract:
 *     { generatedAt, source, count, periods: [oldest -> newest],
 *       routes: { id: { reliabilityMetric, reliability, reliabilityMinStandard,
 *                       operatedPct, operatedMinStandard } } }
 *   Period ids are like "P04 25/26"; `periods` is the union across routes,
 *   sorted chronologically (financial-year start year, then period number).
 *   Both writes are content-stable: identical payloads (ignoring
 *   generatedAt) are not rewritten, so change-gated commits stay quiet.
 *
 * Run: npm run fetch-route-performance
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, headLastModified, userAgentHeaders } from './_lib/http.js';
import { extractPdfRowsByPage }                                 from './_lib/pdf.js';
import { sanitizeRecord }                                       from './_lib/sanitize.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const ROUTES_PATH = path.join(ROOT, 'data', 'api', 'routes.json');
const SRC_PATH    = path.join(ROOT, 'data', 'source', 'route-performance.json');
const API_PATH    = path.join(ROOT, 'data', 'api', 'route-performance.json');
const SCRIPT      = 'route-performance';
const SOURCE_DESC = 'TfL QSI & Mileage per-route PDFs (bus.data.tfl.gov.uk/boroughreports/routes/)';
const CONCURRENCY = 6;

const pdfUrl = (id) => `https://bus.data.tfl.gov.uk/boroughreports/routes/performance-route-${id}.pdf`;

// ── Cell / row shape tests ──────────────────────────────────────────────────
const SERIES_LABEL_RE = /^P(\d{2}) (\d{2}\/\d{2}) to P(\d{2}) (\d{2}\/\d{2})$/;
const NUM_RE          = /^-?\d+(?:\.\d+)?$/;
// Reliability title: "High Frequency - EWT (mins)" / "Low Frequency - % On Time".
// pdfjs splits it into ["High Frequency","-","EWT (mins)"]; match on the join.
const METRIC_TITLE_RE = /^(High|Low) Frequency\s*-\s*(.+)$/;

const isNumRow = (cells) => cells.length > 0 && cells.every(c => NUM_RE.test(c));

/**
 * Map one series row (label + up to 13 numbers) into { "P04 25/26": n, … }.
 * `cols` are the header's column labels. Most routes use a rolling window
 * ("P04 24/25 to P03 25/26", columns 4..13,1..3), but some (55, H26, N89)
 * are calendar-aligned ("P01 25/26 to P13 25/26", columns 1..13). General
 * rule: a column at or after the series' start period belongs to the FIRST
 * financial year in the label; a wrapped column (before the start) belongs
 * to the SECOND.
 */
function seriesToPeriods(label, nums, cols) {
  const m = SERIES_LABEL_RE.exec(label);
  if (!m) return null;
  const [, startP, yearA, , yearB] = m;
  const start = Number(startP);
  const out = {};
  for (let i = 0; i < nums.length && i < cols.length; i++) {
    const p  = cols[i];
    const yr = p >= start ? yearA : yearB;
    out[`P${String(p).padStart(2, '0')} ${yr}`] = Number(nums[i]);
  }
  return out;
}

/**
 * Parse one table starting AFTER its ["Period","4",...] header row: consume
 * series rows ("P04 24/25 to P03 25/26" + 13 numbers, same-row or split-row)
 * and the "Minimum Standard" row, merging series into a single period map.
 * Returns { values, minStandard } or null if nothing parsed.
 */
function parseTable(rows, startIdx, cols) {
  const values = {};
  let minStandard = null;
  let sawSeries = false;

  for (let i = startIdx; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.length) continue;
    const first = cells[0];

    if (first === 'Minimum Standard') {
      // Same-row or split-row, like the series rows.
      let nums = cells.slice(1).filter(c => NUM_RE.test(c));
      if (!nums.length && i + 1 < rows.length && isNumRow(rows[i + 1])) { nums = rows[++i]; }
      if (nums.length) minStandard = Number(nums[nums.length - 1]);   // standard currently in force
      break;                                                          // last row of the table
    }

    if (SERIES_LABEL_RE.test(first)) {
      let nums = cells.slice(1).filter(c => NUM_RE.test(c));
      if (!nums.length && i + 1 < rows.length && isNumRow(rows[i + 1])) { nums = rows[++i]; }
      const mapped = seriesToPeriods(first, nums, cols);
      if (mapped) { Object.assign(values, mapped); sawSeries = true; }
      continue;
    }

    // Anything else after the header that isn't a series or the minimum
    // standard means the table ended unexpectedly -- stop, keep what we have.
    if (sawSeries) break;
  }

  return sawSeries ? { values, minStandard } : null;
}

/**
 * Parse one route PDF's rows (all pages flattened -- reports are one page).
 * Returns { reliabilityMetric, reliability, reliabilityMinStandard,
 *           operatedPct, operatedMinStandard } or throws with a reason.
 */
function parseRoutePdf(pages) {
  const rows = pages.flat();

  let metric = null;
  let inMileage = false;
  let reliability = null;
  let mileage = null;

  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].join(' ').replace(/\s+/g, ' ').trim();

    if (!inMileage) {
      const tm = METRIC_TITLE_RE.exec(joined);
      if (tm) { metric = tm[2].trim(); continue; }
    }
    if (/^Mileage Performance$/.test(joined)) { inMileage = true; continue; }

    // Table header: "Period" followed by the numeric column labels
    // (4..13,1..3 rolling-window, or 1..13 calendar-aligned). The chart
    // legend above it never starts with the literal cell "Period".
    if (rows[i][0] === 'Period' && rows[i].length > 1 && isNumRow(rows[i].slice(1))) {
      const cols  = rows[i].slice(1).map(Number);
      const table = parseTable(rows, i + 1, cols);
      if (table) {
        if (inMileage) { if (!mileage) mileage = table; }
        else           { if (!reliability) reliability = table; }
      }
    }
  }

  if (!metric)      throw new Error('no reliability metric title found');
  if (!reliability) throw new Error('no reliability table parsed');
  if (!mileage)     throw new Error('no mileage table parsed');

  return {
    reliabilityMetric:      metric,
    reliability:            reliability.values,
    reliabilityMinStandard: reliability.minStandard,
    operatedPct:            mileage.values,
    operatedMinStandard:    mileage.minStandard,
  };
}

// ── Period ordering ─────────────────────────────────────────────────────────
// "P04 24/25" -> sort key. Financial year 24/25 runs P01 (April 2024) to
// P13 (March 2025), so chronological order is (FY start year, period number).
function periodSortKey(id) {
  const m = /^P(\d{2}) (\d{2})\/\d{2}$/.exec(id);
  if (!m) return [9999, 99];
  return [2000 + Number(m[2]), Number(m[1])];
}
function sortPeriods(ids) {
  return [...ids].sort((a, b) => {
    const [ya, pa] = periodSortKey(a);
    const [yb, pb] = periodSortKey(b);
    return ya - yb || pa - pb;
  });
}

// ── Cache ───────────────────────────────────────────────────────────────────
function loadPriorRoutes() {
  if (!fs.existsSync(SRC_PATH)) return new Map();
  try {
    const j = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
    return new Map(Object.entries(j.routes ?? {}));
  } catch {
    return new Map();
  }
}

// ── Per-route fetch + parse ─────────────────────────────────────────────────
async function processRoute(id, cached, force) {
  const url = pdfUrl(id);

  // Skip-if-unchanged: HEAD first when we have a cached parse with a
  // Last-Modified. TfL republishes quarterly, so steady-state runs resolve
  // almost every route here without downloading the body.
  if (!force && cached?.lastModified) {
    const head = await headLastModified(url, SCRIPT);
    if (head.status === 200 && head.lastModified && head.lastModified === cached.lastModified) {
      return { id, status: 'cached', record: cached };
    }
    if (head.status === 404) return { id, status: 'missing' };
  }

  const res = await fetchWithTimeout(url, { headers: userAgentHeaders(SCRIPT) });
  if (res.status === 404) return { id, status: 'missing' };
  if (!res.ok) return { id, status: 'error', error: `HTTP ${res.status}` };

  const lm  = res.headers.get('last-modified');
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    const pages  = await extractPdfRowsByPage(buf);
    const parsed = parseRoutePdf(pages);
    return {
      id,
      status: 'parsed',
      record: { lastModified: lm ? new Date(lm).toISOString() : null, ...parsed },
    };
  } catch (err) {
    return { id, status: 'error', error: err.message };
  }
}

// ── Content-stable write (compare ignoring generatedAt) ─────────────────────
function writeStable(filePath, payload, label) {
  const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
  let unchanged = false;
  if (fs.existsSync(filePath)) {
    try { unchanged = stable(JSON.parse(fs.readFileSync(filePath, 'utf8'))) === stable(payload); }
    catch { /* unreadable prior file -- rewrite it */ }
  }
  if (unchanged) {
    console.log(`${label}: unchanged, not rewriting ${filePath}`);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    console.log(`${label}: wrote ${filePath}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const force  = process.argv.includes('--force');
  const routes = JSON.parse(fs.readFileSync(ROUTES_PATH, 'utf8'))
    .map(r => String(r.id).toUpperCase());
  const ids    = [...new Set(routes)].sort();
  const prior  = loadPriorRoutes();

  console.log(`Fetching QSI & mileage performance for ${ids.length} routes (concurrency ${CONCURRENCY})…`);

  const results  = new Map();
  let done = 0, cachedCount = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const r  = await processRoute(id, prior.get(id), force);
      results.set(id, r);
      if (r.status === 'cached') cachedCount++;
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${ids.length} done (${cachedCount} from cache)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const routesOut      = {};
  const missingRoutes  = [];
  const parseFailures  = [];
  for (const id of ids) {
    const r = results.get(id);
    if (r.status === 'parsed' || r.status === 'cached') routesOut[id] = r.record;
    else if (r.status === 'missing') missingRoutes.push(id);
    else parseFailures.push({ id, error: r.error });
  }

  // Validate against known route-67 figures from the PDF (fails loudly if
  // TfL changes the layout under us). Skipped if 67's data has rolled on
  // past these periods -- the assertion is period-specific.
  const r67 = routesOut['67'];
  if (r67 && 'P04 25/26' in (r67.operatedPct ?? {})) {
    const ok = r67.operatedPct['P04 25/26'] === 96.61
      && r67.reliability['P04 25/26'] === 1.18
      && r67.operatedMinStandard === 98;
    if (!ok) throw new Error(`route 67 validation failed: ${JSON.stringify({
      operated: r67.operatedPct['P04 25/26'],
      reliability: r67.reliability['P04 25/26'],
      minStd: r67.operatedMinStandard,
    })}`);
    console.log('Route 67 validation passed.');
  }

  const generatedAt = new Date().toISOString();
  const routeCount  = Object.keys(routesOut).length;

  const src = sanitizeRecord({
    generatedAt,
    source: SOURCE_DESC,
    routeCount,
    missingRoutes,
    parseFailures,
    routes: routesOut,
  });
  writeStable(SRC_PATH, src, 'source');

  // Served file: union of period ids across every route, oldest -> newest.
  const periodSet = new Set();
  const apiRoutes = {};
  for (const [id, rec] of Object.entries(src.routes)) {
    for (const p of Object.keys(rec.reliability ?? {})) periodSet.add(p);
    for (const p of Object.keys(rec.operatedPct ?? {})) periodSet.add(p);
    apiRoutes[id] = {
      reliabilityMetric:      rec.reliabilityMetric,
      reliability:            rec.reliability,
      reliabilityMinStandard: rec.reliabilityMinStandard,
      operatedPct:            rec.operatedPct,
      operatedMinStandard:    rec.operatedMinStandard,
    };
  }
  writeStable(API_PATH, {
    generatedAt,
    source: SOURCE_DESC,
    count: routeCount,
    periods: sortPeriods(periodSet),
    routes: apiRoutes,
  }, 'api');

  console.log(`\n${routeCount} routes parsed, ${missingRoutes.length} missing (404), ` +
    `${parseFailures.length} parse failures, ${cachedCount} served from cache`);
  if (missingRoutes.length) console.log(`Missing: ${missingRoutes.join(', ')}`);
  for (const f of parseFailures) console.log(`Parse failure ${f.id}: ${f.error}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
