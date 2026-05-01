/**
 * fetch-tender-programme.js -- Upcoming TfL bus tender schedule (Phase 2b).
 *
 * Source: TfL publishes one PDF per financial year listing every scheduled
 * tender, grouped by tranche, with planned issue / return / award / start
 * dates and the required vehicle spec.
 *
 *   tfl.gov.uk/cdn/static/cms/documents/uploads/forms/{YYYY-YYYY}-lbsl-tendering-programme.pdf
 *
 * 10 financial years discovered (2017/18 through 2026/27). Each PDF is small
 * (~80-400 KB) so the whole crawl is sub-minute and worth re-running weekly
 * to catch TfL's mid-year programme updates.
 *
 * PDF table layout (8 columns):
 *   Tranche | Routes | Route Details | Tender Issue | Tender Return | Contract Award | Contract Start | Vehicles
 *
 * Quirks handled:
 *   - Multi-route tranches: only the FIRST row in a tranche carries the
 *     tranche number; subsequent rows inherit it from the prior row.
 *   - Long route descriptions wrap to a separate line above the data row.
 *     Detect by absence of any date cell, then merge into the next row.
 *   - 'x' marker after a route number = "eligible for two-year extension".
 *   - Vehicle column: 'DD' / 'SD (45)' / 'SD (60)' / 'ZEDD' / 'ZESD' etc.
 *   - Contract Award is month-only ('Jun-25') because TfL marks it estimated
 *     -- stored as text rather than DATE so we don't lose information.
 *
 * Output: data/source/tender-programme.json (force-committed across runs)
 *   {
 *     generatedAt,
 *     years: [
 *       { programme_year, source_url, pdf_modified_at, entries: [...] }
 *     ]
 *   }
 *
 * Run: npm run fetch-tender-programme
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { sanitizeRecord } from './_lib/sanitize.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'source', 'tender-programme.json');
const USER_AGENT = 'london-buses-map/2.6 (programme; +https://london-buses.farhan.app)';
const TIMEOUT_MS = 30_000;

// Programme years to fetch -- expand the upper bound when TfL publishes a
// new financial-year programme (typically September each year).
const YEARS = [
  '2017-2018', '2018-2019', '2019-2020', '2020-2021', '2021-2022',
  '2022-2023', '2023-2024', '2024-2025', '2025-2026', '2026-2027',
];

const PDF_URL = (yr) => `https://tfl.gov.uk/cdn/static/cms/documents/uploads/forms/${yr}-lbsl-tendering-programme.pdf`;

// Worker setup (same pattern as fetch-route-performance.js)
pdfjs.GlobalWorkerOptions.workerSrc =
  pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

// ── HTTP fetch ──────────────────────────────────────────────────────────────
async function fetchPdf(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      if (res.status === 404) return null;          // year not yet published
      throw new Error(`HTTP ${res.status}`);
    }
    const lastMod = res.headers.get('last-modified');
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, lastModified: lastMod ? new Date(lastMod).toISOString() : null };
  } finally {
    clearTimeout(timer);
  }
}

// HEAD-only request so we can skip the body when Last-Modified matches cache.
async function fetchPdfModified(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      if (res.status === 404) return { status: 404, lastModified: null };
      return { status: res.status, lastModified: null };
    }
    const lastMod = res.headers.get('last-modified');
    return { status: 200, lastModified: lastMod ? new Date(lastMod).toISOString() : null };
  } catch {
    return { status: 0, lastModified: null };
  } finally {
    clearTimeout(timer);
  }
}

// Load the previous run's per-year entries so we can copy them forward when
// a year's PDF Last-Modified hasn't moved.
function loadPriorYears() {
  if (!fs.existsSync(OUT_PATH)) return new Map();
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    const map = new Map();
    for (const yr of (j.years ?? [])) map.set(yr.programme_year, yr);
    return map;
  } catch {
    return new Map();
  }
}

// ── PDF → row[][] (per page, position-clustered) ────────────────────────────
async function extractRows(buffer) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pages = [];
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
    const rows = [...byY.keys()]
      .sort((a, b) => b - a)                                // top-to-bottom (PDF y0 = bottom)
      .map(y => byY.get(y).sort((a, b) => a.x - b.x).map(c => c.s));
    pages.push(rows);
  }
  return pages;
}

// ── Cell-level helpers ──────────────────────────────────────────────────────
const DD_MON_YY  = /^\d{1,2}-[A-Za-z]{3}-\d{2}$/;          // '04-Mar-25'
const MON_YY     = /^[A-Za-z]{3}-\d{2}$/;                  // 'Jun-25'
const TRANCHE_RE = /^\d{3,5}$/;                            // '954' .. '1029'
const ROUTE_RE   = /^[A-Z]{0,3}\d{1,4}[A-Z]?(?:\/[A-Z]?\d{0,4}[A-Z]?)?$/;

function isDateCell(s) { return DD_MON_YY.test(s) || MON_YY.test(s); }
function isTrancheCell(s) { return TRANCHE_RE.test(s); }
function looksLikeRouteId(s) {
  return ROUTE_RE.test(s) && !TRANCHE_RE.test(s) && !isDateCell(s);
}

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseDdMonYy(s) {
  // '04-Mar-25' -> '2025-03-04'
  if (!DD_MON_YY.test(s)) return null;
  const [d, mon, yy] = s.split('-');
  const m = MONTHS[mon.slice(0, 3).toLowerCase()];
  if (!m) return null;
  // Pivot: '70-99' = 19xx, '00-69' = 20xx -- TfL programme PDFs go back to
  // 2017 so any 2-digit year here is post-2000.
  const year = 2000 + parseInt(yy, 10);
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Row parser ──────────────────────────────────────────────────────────────
// Walk one page's rows in visual order, keep a sticky `currentTranche` and
// a "wrapping description" buffer for rows that contain only a long route
// description (no dates, no numbers).
function parsePage(rows, programmeYear, sourceUrl, pdfModifiedAt) {
  const entries = [];
  let currentTranche = null;
  let wrappedDescription = '';

  for (const cells of rows) {
    if (!cells.length) continue;

    // Skip header / disclaimer rows
    const joined = cells.join(' | ');
    if (/Tendering Programme$/.test(joined) ||
        /^Tranche\s*\|\s*Routes/i.test(joined) ||
        /All routes and route details shown are subject/i.test(joined) ||
        /Indicates route eligible/i.test(joined) ||
        /Tender Issue, Tender Return/i.test(joined) ||
        /^\* Indicates/i.test(joined)) {
      continue;
    }

    // Pull date cells out of the row (they're always at fixed column positions)
    const dateCells = cells.filter(isDateCell);
    if (dateCells.length === 0) {
      // No dates -> probably a wrapped route description, hold it for the next row
      // Skip rows that look like raw text noise
      const flat = cells.join(' ').trim();
      if (flat.length > 6 && !/^Page\s+\d+/i.test(flat)) wrappedDescription = flat;
      continue;
    }

    // Identify whether the leading cell is a tranche, a route, or absent (continuation row)
    let idx = 0;
    if (isTrancheCell(cells[idx])) {
      currentTranche = cells[idx];
      idx++;
    }

    // Route id
    const routeId = cells[idx];
    if (!routeId || !looksLikeRouteId(routeId)) {
      // Couldn't find a recognisable route id -- skip
      continue;
    }
    idx++;

    // Optional 'x' two-year-extension marker
    let twoYearExtension = false;
    if (cells[idx] === 'x' || cells[idx] === '*') {
      twoYearExtension = true;
      idx++;
    }

    // Route details = everything between the route-id (or extension marker)
    // and the first date cell. May be empty if the description was wrapped to
    // the previous line.
    const firstDateIdx = cells.findIndex((c, i) => i >= idx && isDateCell(c));
    const description = (firstDateIdx > idx
      ? cells.slice(idx, firstDateIdx).join(' ')
      : '').trim();
    const fullDescription = (description || wrappedDescription || '').trim() || null;
    wrappedDescription = '';   // consumed

    // Date cells in order: tender_issue, tender_return, award (month-only), contract_start
    const dateBlock = cells.slice(firstDateIdx);
    const tenderIssue   = dateBlock[0] && DD_MON_YY.test(dateBlock[0]) ? parseDdMonYy(dateBlock[0]) : null;
    const tenderReturn  = dateBlock[1] && DD_MON_YY.test(dateBlock[1]) ? parseDdMonYy(dateBlock[1]) : null;
    const awardEst      = dateBlock[2] && MON_YY.test(dateBlock[2])    ? dateBlock[2]               : null;
    const contractStart = dateBlock[3] && DD_MON_YY.test(dateBlock[3]) ? parseDdMonYy(dateBlock[3]) : null;

    // Vehicle column (last cell) -- everything from index 4 onwards in dateBlock.
    const vehicleType = dateBlock.slice(4).join(' ').trim() || null;

    entries.push({
      programme_year:        programmeYear,
      tranche:               currentTranche,
      route_id:              routeId,
      tender_issue_date:     tenderIssue,
      tender_return_date:    tenderReturn,
      award_estimated:       awardEst,
      contract_start_date:   contractStart,
      route_description:     fullDescription,
      vehicle_type:          vehicleType,
      two_year_extension:    twoYearExtension,
      source_url:            sourceUrl,
      pdf_modified_at:       pdfModifiedAt,
      data_as_of:            pdfModifiedAt ? pdfModifiedAt.slice(0, 10) : null,
    });
  }

  return entries;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const out = { generatedAt: new Date().toISOString(), years: [] };
  let totalEntries = 0;
  let yearsWithData = 0;
  let cacheHits    = 0;
  const force      = process.argv.includes('--force');
  const prior      = loadPriorYears();

  for (const year of YEARS) {
    const url = PDF_URL(year);
    process.stdout.write(`  ${year} ... `);

    // Skip-if-unchanged: HEAD first. Closed financial years never change once
    // the year has rolled over, so almost every run hits this fast path for
    // 9 of 10 years. The active year (and any year TfL re-published mid-cycle)
    // falls through to the full fetch + parse.
    if (!force && prior.has(year)) {
      const head = await fetchPdfModified(url);
      const cached = prior.get(year);
      if (head.status === 200 && head.lastModified && cached.pdf_modified_at === head.lastModified) {
        out.years.push(cached);
        totalEntries += cached.entry_count ?? cached.entries?.length ?? 0;
        if ((cached.entry_count ?? cached.entries?.length ?? 0) > 0) yearsWithData++;
        cacheHits++;
        console.log(`unchanged (Last-Modified ${head.lastModified}) — using cache`);
        continue;
      }
      if (head.status === 404) { console.log('not published yet'); continue; }
    }

    let download;
    try {
      download = await fetchPdf(url);
    } catch (err) {
      console.log(`fetch failed: ${err.message}`);
      continue;
    }
    if (!download) { console.log('not published yet'); continue; }

    let pages;
    try {
      pages = await extractRows(download.buffer);
    } catch (err) {
      console.log(`PDF parse failed: ${err.message}`);
      continue;
    }

    const entries = [];
    for (const rows of pages) {
      entries.push(...parsePage(rows, year, url, download.lastModified));
    }
    console.log(`${entries.length} entries`);
    out.years.push({
      programme_year:  year,
      source_url:      url,
      pdf_modified_at: download.lastModified,
      entry_count:     entries.length,
      entries,
    });
    totalEntries += entries.length;
    yearsWithData++;
  }
  if (cacheHits) console.log(`  ${cacheHits} year(s) served from cache`);

  out.totalEntries = totalEntries;
  out.yearsWithData = yearsWithData;
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(sanitizeRecord(out)), 'utf8');
  console.log(`\nWrote ${totalEntries} entries across ${yearsWithData} years to ${OUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
